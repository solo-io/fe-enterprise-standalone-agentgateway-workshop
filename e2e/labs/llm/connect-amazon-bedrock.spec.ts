// labs/llm/connect-amazon-bedrock.md
// @fixture base
import { expect, test } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, chatRequest, HAS_AWS, HAS_BEDROCK_KEY, lab } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'connect-amazon-bedrock');

test.describe.configure({ mode: 'serial' });

const NO_AWS = 'needs working AWS credentials (AWS_ACCESS_KEY_ID in the shell or setup/.env)';
const HAIKU = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const SONNET = 'us.anthropic.claude-sonnet-4-6';
// The line the reader adds under awsRegion in Raw Configuration.
const KEY_LINE = 'apiKey: $BEDROCK_API_KEY';

test('add the Bedrock wildcard model', async ({ page }) => {
  test.skip(!HAS_AWS, NO_AWS);
  await go(page, '/llm/models');
  // The lab shows connect-llm-providers/01-models-empty.png for this step.
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();

  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Amazon Bedrock', exact: true }).click();
  await expect(d.getByRole('textbox', { name: /Incoming model match/ })).toHaveValue('bedrock/*');
  await d.getByRole('button', { name: 'Ambient', exact: true }).click();
  await d.getByRole('textbox', { name: 'AWS region' }).fill('us-west-2');
  // Close the region suggestions (Escape would close the whole panel).
  await d.getByRole('heading', { name: 'Add model' }).click();
  await d.getByRole('combobox', { name: 'Bedrock endpoint' }).click();
  await page.getByRole('option', { name: 'Prefer Runtime', exact: true }).click();
  await d.getByRole('button', { name: 'Strip bedrock/', exact: true }).click();
  await expect(d).not.toContainText('Model warnings');
  await shot(page, '02-add-bedrock-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  await expect(page.locator('main').getByRole('row', { name: /bedrock\/\*/ })).toBeVisible();
  await shot(page, '03-models-bedrock');
  const m = readConfig().llm.models.find((x: any) => x.name === 'bedrock/*');
  expect(m).toEqual({
    name: 'bedrock/*',
    provider: 'bedrock',
    params: { awsRegion: 'us-west-2', bedrockEndpointPreference: 'runtimePreferred' },
    transformation: { model: 'llmRequest.model.stripPrefix("bedrock/")' },
  });
});

test('chat with Claude Haiku on Bedrock', async ({ page }) => {
  test.skip(!HAS_AWS, NO_AWS);
  await go(page, '/llm/playground');
  const reply = await chat(page, { model: 'bedrock/*', specific: HAIKU, prompt: 'Reply with the single word: pong' });
  expect(reply).toMatch(/pong/i);
  expect(reply).toContain('OK');
  await shot(page, '04-playground-reply', page.locator('.chat-message.assistant').last());
});

test('see the Bedrock request in Logs', async ({ page }) => {
  test.skip(!HAS_AWS, NO_AWS);
  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: `bedrock/${HAIKU}` }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('200');
  await expect(row).toContainText('aws.bedrock');
  await expect(row).toContainText(/\$0\.\d+/);
  await shot(page, '05-logs');

  // The optional curl, after the screenshot so its row does not show in it.
  const r = await chatRequest(`bedrock/${SONNET}`, 'Hello from agentgateway');
  expect(r.status).toBe(200);
  expect(JSON.parse(r.text).model).toBe(SONNET);
});

test('optional: switch the model to a Bedrock API key', async ({ page }) => {
  test.skip(!HAS_AWS, NO_AWS);
  test.skip(!HAS_BEDROCK_KEY, 'needs BEDROCK_API_KEY in the shell or setup/.env');
  await go(page, '/raw-config');
  const region = page.locator('main .monaco-editor .view-line', { hasText: 'awsRegion: us-west-2' });
  await expect(region).toHaveCount(1);
  await region.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  // Monaco keeps the indentation of the line above.
  await page.keyboard.insertText(KEY_LINE);
  const added = page.locator('main .monaco-editor .view-line', { hasText: 'apiKey: $BEDROCK' });
  await expect.poll(async () => (await added.innerText()).replace(/ /g, ' ').trim()).toBe(KEY_LINE);
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '06-raw-config-api-key', saveBtn);
  await saveBtn.click();
  await expect.poll(() => readConfig().llm.models.find((x: any) => x.name === 'bedrock/*').params).toEqual({
    awsRegion: 'us-west-2',
    apiKey: '$BEDROCK_API_KEY',
    bedrockEndpointPreference: 'runtimePreferred',
  });
  await page.waitForTimeout(2000);

  const r = await chatRequest(`bedrock/${HAIKU}`, 'Reply with the single word: pong');
  expect(r.status).toBe(200);
  expect(JSON.parse(r.text).choices[0].message.content).toMatch(/pong/i);
});

test('clean up: delete the Bedrock model', async ({ page }) => {
  test.skip(!HAS_AWS, NO_AWS);
  await go(page, '/llm/models');
  const row = page.locator('main').getByRole('row').filter({ has: page.getByText('bedrock/*', { exact: true }) });
  const del = row.getByRole('button', { name: /^Delete/ });
  await shot(page, '07-delete-model', del);
  await del.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete model' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(readConfig().llm.models ?? []).toEqual([]);
});
