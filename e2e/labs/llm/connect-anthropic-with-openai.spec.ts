// labs/llm/connect-anthropic.md, "Optional: compare Claude with GPT"
// @fixture base
// Repeats Steps 1 and 2 without screenshots; connect-anthropic.spec.ts captures those.
// The optional section adds the openai/* model itself, and the cleanup deletes it.
// Needs ANTHROPIC_API_KEY in setup/.env; every test is skipped without it.
import { expect, test } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, HAS_ANTHROPIC, lab, labSh } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';

const { go, shot, save } = lab('llm', 'connect-anthropic');

test.describe.configure({ mode: 'serial' });

const NO_KEY = 'ANTHROPIC_API_KEY in setup/.env is not set or not accepted';

test.beforeEach(() => test.skip(!HAS_ANTHROPIC, NO_KEY));

test('add the Anthropic provider and the anthropic/* model', async ({ page }) => {
  await go(page, '/llm/providers');
  await page.getByRole('button', { name: 'Add provider' }).first().click();
  let d = page.getByRole('dialog');
  await d.getByPlaceholder('openai-prod').fill('anthropic');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('ANTHROPIC_API_KEY');
  await save(page, 'Save provider');

  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: /^anthropic\s*configured/ }).click();
  await d.getByRole('button', { name: 'Strip anthropic/', exact: true }).click();
  await save(page, 'Save model');

  expect(readConfig().llm.models.map((m: any) => m.name)).toEqual(['anthropic/*']);
});

test('optional section: add the OpenAI model', async ({ page }) => {
  await addOpenAIModel(page);
  expect(readConfig().llm.models.map((m: any) => m.name)).toEqual(['anthropic/*', 'openai/*']);
});

test('ask GPT and Claude in the Chat Playground', async ({ page }) => {
  await go(page, '/llm/playground');
  const gpt = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: 'Reply with the single word: pong' });
  expect(gpt).toMatch(/pong/i);
  expect(gpt).toContain('OK');
  const claude = await chat(page, { model: 'anthropic/*', specific: 'claude-haiku-5-5', prompt: 'Reply with the single word: pong' });
  expect(claude).toMatch(/pong/i);
  expect(claude).toContain('OK');
  await shot(page, '08-playground-gpt-and-claude', page.locator('.chat-message.assistant').last());
});

test('the same OpenAI-format curl reaches GPT', async () => {
  const body = JSON.parse(labSh(`curl -s http://localhost:4000/v1/chat/completions \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'`).stdout);
  expect(body.object).toBe('chat.completion');
  expect(body.model).toMatch(/^gpt-6-luna/);
});

test('Analytics splits tokens between the providers', async ({ page }) => {
  await go(page, '/llm/logs');
  const main = page.locator('main');
  await expect(main.locator('tbody tr').filter({ hasText: 'openai/gpt-6-luna' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(main.locator('tbody tr').filter({ hasText: 'anthropic/claude-haiku-5-5' }).first()).toBeVisible();

  await go(page, '/llm/analytics');
  await main.getByRole('button', { name: 'Total', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Provider', exact: true }).check();
  await page.keyboard.press('Escape');
  const legend = main.getByText('anthropic', { exact: true }).first();
  await expect(legend).toBeVisible();
  await expect(main.getByText('openai', { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1000);
  await shot(page, '09-analytics-both', legend);
});

test('clean up: delete the models and the provider', async ({ page }) => {
  await go(page, '/llm/models');
  const row = page.locator('main').getByRole('row').filter({ has: page.getByText('anthropic/*', { exact: true }) });
  await row.getByRole('button', { name: 'Delete model' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete model' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);
  await deleteModel(page);

  await go(page, '/llm/providers');
  const prow = page.locator('main').getByRole('row').filter({ hasText: 'anthropic' });
  await prow.getByRole('button', { name: 'Delete provider' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete provider' }).click();
  await expect(prow).toHaveCount(0);
  await page.waitForTimeout(1000);

  const cfg = readConfig();
  expect(cfg.llm.providers ?? []).toEqual([]);
  expect(cfg.llm.models ?? []).toEqual([]);
});
