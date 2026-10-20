// labs/llm/connect-anthropic.md
// Main path, from base. The optional OpenAI comparison runs in connect-anthropic-with-openai.spec.ts.
// Needs ANTHROPIC_API_KEY in setup/.env; every test is skipped without it.
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { readConfig } from '../../lib/config';
import { chat, HAS_ANTHROPIC, lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'connect-anthropic');

test.describe.configure({ mode: 'serial' });

const CLAUDE = 'anthropic/claude-haiku-5-5';
const NO_KEY = 'ANTHROPIC_API_KEY is not set in setup/.env';

test.beforeEach(() => test.skip(!HAS_ANTHROPIC, NO_KEY));

/** Sends the lab's OpenAI-format curl and returns the parsed body and status. */
function chatCompletions(model: string) {
  const r = sh(`curl -s -w '\\nHTTP %{http_code}' http://localhost:4000/v1/chat/completions \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"${model}","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'`);
  return { status: r.stdout.match(/\nHTTP (\d+)$/)?.[1], body: JSON.parse(r.stdout.replace(/\nHTTP \d+$/, '')) };
}

test('add the Anthropic provider', async ({ page }) => {
  await go(page, '/llm/providers');
  const add = page.getByRole('button', { name: 'Add provider' }).first();
  await shot(page, '01-providers-empty', add);
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('openai-prod').fill('anthropic');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('ANTHROPIC_API_KEY');
  await shot(page, '02-add-provider', d.getByRole('button', { name: 'Save provider' }));
  await save(page, 'Save provider');

  await expect(page.locator('main').getByRole('row', { name: /anthropic/ })).toBeVisible();
  expect(readConfig().llm.providers).toEqual([{ name: 'anthropic', provider: 'anthropic', params: { apiKey: '$ANTHROPIC_API_KEY' } }]);
});

test('add the anthropic/* wildcard model', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: /^anthropic\s*configured/ }).click();
  await expect(d.getByRole('textbox', { name: /Incoming model match/ })).toHaveValue('anthropic/*');
  await d.getByRole('button', { name: 'Strip anthropic/', exact: true }).click();
  await shot(page, '03-add-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  await expect(page.locator('main')).toContainText('anthropic/*');
  await shot(page, '04-models');
  const m = readConfig().llm.models.find((x: any) => x.name === 'anthropic/*');
  expect(m).toEqual({
    name: 'anthropic/*',
    provider: { reference: 'anthropic' },
    transformation: { model: 'llmRequest.model.stripPrefix("anthropic/")' },
  });
});

test('chat with Claude in the Chat Playground', async ({ page }) => {
  await go(page, '/llm/playground');
  const claude = await chat(page, { model: 'anthropic/*', specific: 'claude-haiku-5-5', prompt: 'Reply with the single word: pong' });
  expect(claude).toMatch(/pong/i);
  expect(claude).toContain('OK');
  await shot(page, '05-playground-claude', page.locator('.chat-message.assistant').last());
});

test('the OpenAI-format curl reaches Claude', async () => {
  const b = chatCompletions(CLAUDE);
  expect(b.status).toBe('200');
  expect(b.body.object).toBe('chat.completion');
  expect(b.body.model).toMatch(/^claude-haiku-5-5/);
  expect(b.body.id).toMatch(/^msg_/);
  writeFileSync('/repo/e2e/.last/connect-anthropic-curl.json', JSON.stringify(b.body, null, 2));
});

test('the Anthropic Messages API answers through the gateway', async () => {
  const r = sh(`curl -s -w '\\nHTTP %{http_code}' http://localhost:4000/v1/messages \\
    -H 'Content-Type: application/json' \\
    -H 'anthropic-version: 2023-06-01' \\
    -d '{"model":"${CLAUDE}","max_tokens":1024,"messages":[{"role":"user","content":"Reply with the single word: pong"}]}'`);
  expect(r.stdout).toMatch(/\nHTTP 200$/);
  const body = JSON.parse(r.stdout.replace(/\nHTTP \d+$/, ''));
  expect(body.type).toBe('message');
  expect(body.role).toBe('assistant');
  expect(body.model).toMatch(/^claude-haiku-5-5/);
  writeFileSync('/repo/e2e/.last/connect-anthropic-messages.json', JSON.stringify(body, null, 2));
});

test('see the Anthropic requests in Logs and Analytics', async ({ page }) => {
  await go(page, '/llm/logs');
  const main = page.locator('main');
  const claude = main.locator('tbody tr').filter({ hasText: CLAUDE }).first();
  await expect(claude).toBeVisible({ timeout: 30_000 });
  await expect(claude).toContainText('200');
  await shot(page, '06-logs', claude);

  await go(page, '/llm/analytics');
  const groupBy = main.getByRole('button', { name: 'Total', exact: true });
  await groupBy.click();
  await page.getByRole('checkbox', { name: 'Provider', exact: true }).check();
  await page.keyboard.press('Escape');
  const legend = main.getByText('anthropic', { exact: true }).first();
  await expect(legend).toBeVisible();
  await page.waitForTimeout(1000);
  writeFileSync('/repo/e2e/.last/connect-anthropic-analytics.txt', await main.innerText());
  await shot(page, '07-analytics', legend);
});

test('clean up: delete the model and the provider', async ({ page }) => {
  await go(page, '/llm/models');
  const row = page.locator('main').getByRole('row').filter({ has: page.getByText('anthropic/*', { exact: true }) });
  await row.getByRole('button', { name: 'Delete model' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete model' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);

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
