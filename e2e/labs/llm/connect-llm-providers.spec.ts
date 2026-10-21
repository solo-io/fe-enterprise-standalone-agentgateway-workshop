// labs/llm/connect-llm-providers.md
// @fixture base
import { expect, test } from '@playwright/test';
import { chat, lab, labSh } from '../../lib/lab';
import { deleteModel } from '../../lib/setup';

const { go, shot, save } = lab('llm', 'connect-llm-providers');

test.describe.configure({ mode: 'serial' });

test('add the OpenAI wildcard model', async ({ page }) => {
  await go(page, '/llm/models');
  const add = page.getByRole('button', { name: 'Add model', exact: true }).first();
  await shot(page, '01-models-empty', add);
  await add.click();

  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
  await expect(d.getByRole('textbox', { name: /Incoming model match/ })).toHaveValue('openai/*');
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('OPENAI_API_KEY');
  await d.getByRole('button', { name: 'Strip openai/', exact: true }).click();
  await shot(page, '02-add-openai-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  await expect(page.locator('main')).toContainText('openai/*');
  await shot(page, '03-models-openai');
});

test('chat in the Chat Playground', async ({ page }) => {
  await go(page, '/llm/playground');
  const reply = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: 'Reply with the single word: pong' });
  expect(reply).toMatch(/pong/i);
  expect(reply).toContain('OK');
  await shot(page, '04-playground-reply', page.locator('.chat-message.assistant').last());
});

test('see the request in Logs', async ({ page }) => {
  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: 'openai/gpt-6-luna' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('200');
  await shot(page, '05-logs');
});

test('curl from Client Setup works', async ({ page }) => {
  await go(page, '/llm/client-setup');
  await page.locator('main').getByPlaceholder('Select or type a model').fill('gpt-6-luna');
  await page.locator('main').getByRole('heading', { name: 'Client Setup' }).click(); // close the suggestion list
  await expect(page.locator('main')).toContainText('"model": "openai/gpt-6-luna"');
  await shot(page, '06-client-setup', page.locator('main').getByRole('button', { name: 'Copy' }));
  // No -s in the copied command, so curl's progress meter (stderr) follows the body.
  const r = labSh(`curl "http://localhost:4000/v1/chat/completions" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "openai/gpt-6-luna",
    "messages": [
      { "role": "user", "content": "Hello from agentgateway" }
    ]
  }'`);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain('"object":"chat.completion"');
  expect(r.stdout).toContain('"model":"gpt-6-luna');
});

test('clean up: delete the model', async ({ page }) => {
  await deleteModel(page, 'openai/*', (del) => shot(page, '07-delete-model', del));
});
