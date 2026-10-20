// labs/llm/moderation-guardrails.md
// @fixture llm-ready
import { expect, test, type Page } from '@playwright/test';
import { chat, chatRequest, lab } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot } = lab('llm', 'moderation-guardrails');

test.describe.configure({ mode: 'serial' });

const BODY = 'Request blocked by OpenAI Moderation.';
const VIOLENT = 'I am going to kill my neighbor tonight with a knife and hide the body.';
const BENIGN = 'What is the capital of France? Answer in one word.';
// The line the reader writes in Raw Configuration, in place of "- openAIModeration: {}".
const AUTH_LINE = '- openAIModeration: { policies: { backendAuth: { key: $OPENAI_API_KEY } } }';

test('add the OpenAI Moderation request guard', async ({ page }) => {
  await go(page, '/llm/guardrails');
  const main = page.locator('main');
  await expect(main).toContainText('No guards configured.');
  const add = main.getByRole('button', { name: 'Add guard', exact: true }).first();
  await shot(page, '01-guardrails-empty', add);
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Guard type' }).click();
  await page.getByRole('option', { name: /^OpenAI Moderation/ }).click();
  await expect(d).toContainText('Defaults to omni-moderation-latest.');
  await d.getByPlaceholder('The request was rejected due to inappropriate content').fill(BODY);
  await shot(page, '02-moderation-guard', d.getByRole('button', { name: 'Add guard' }));
  await d.getByRole('button', { name: 'Add guard' }).click();
  await expect(d).toBeHidden();
  await expect(main).toContainText('Default moderation model.');
  const saveBtn = page.getByRole('button', { name: 'Save guardrails' });
  await shot(page, '03-save-guardrails', saveBtn);
  await saveBtn.click();
  await expect(saveBtn).toBeHidden({ timeout: 10_000 });
  expect(readConfig().llm.policies.guardrails.request[0].openAIModeration).toEqual({});

  // The lab says: until Step 2, every LLM request fails with "prompt guard failed".
  await page.waitForTimeout(2000);
  const r = await chatRequest('openai/gpt-6-luna', BENIGN);
  expect(r.status).not.toBe(200);
  expect(r.text).toContain('prompt guard failed');
});

/** In the Raw Configuration editor, selects the text of the line that contains `text`. */
async function selectLine(page: Page, text: string) {
  const line = page.locator('.view-line', { hasText: text });
  await expect(line).toHaveCount(1);
  await line.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
}

test('give the guard the OpenAI key in Raw Configuration', async ({ page }) => {
  await go(page, '/raw-config');
  await selectLine(page, 'openAIModeration: {}');
  await shot(page, '04-raw-config-line');
  // The reader copies the line from the lab and pastes it over the selection.
  await page.keyboard.insertText(AUTH_LINE);
  // Monaco renders spaces as non-breaking spaces; no auto-closed braces may follow the line.
  const edited = page.locator('.view-line', { hasText: 'backendAuth' });
  await expect.poll(async () => (await edited.innerText()).replace(/\u00a0/g, ' ').trim()).toBe(AUTH_LINE);
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '05-raw-config-key', saveBtn);
  await saveBtn.click();
  await expect.poll(() => readConfig().llm.policies.guardrails.request[0].openAIModeration).toEqual({
    policies: { backendAuth: { key: '$OPENAI_API_KEY' } },
  });
});

test('a violent prompt is blocked, a normal prompt passes', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-6-luna');
  await main.getByPlaceholder('Ask a test question...').fill(VIOLENT);
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(main.getByText('Playground request failed')).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText(BODY);
  await shot(page, '06-blocked');

  await go(page, '/llm/playground');
  await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: BENIGN });
  // The status chip, not the reply text, so a model reply that says "OK" cannot pass.
  await expect(main.locator('.chat-message.assistant').last().locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  await expect(main.getByText('Playground request failed')).toHaveCount(0);
  await shot(page, '07-benign-ok', page.locator('.chat-message.assistant').last());

  expect(await chatRequest('openai/gpt-6-luna', VIOLENT)).toEqual({ status: 403, text: BODY });
  expect((await chatRequest('openai/gpt-6-luna', BENIGN)).status).toBe(200);
});

test('clean up: remove the guard', async ({ page }) => {
  await go(page, '/llm/guardrails');
  const main = page.locator('main');
  const removeAll = main.getByRole('button', { name: 'Remove', exact: true }).first();
  await shot(page, '08-remove-all', removeAll);
  await removeAll.click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Remove all LLM guardrails?');
  await confirm.getByRole('button', { name: 'Remove guardrails' }).click();
  await expect(confirm).toBeHidden();
  await expect(main.getByText('No guards configured.')).toHaveCount(2);
  await page.waitForTimeout(2000);
  expect((await chatRequest('openai/gpt-6-luna', VIOLENT)).status).toBe(200);
});
