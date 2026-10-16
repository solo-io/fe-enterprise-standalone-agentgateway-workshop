// labs/llm/connect-coding-agents.md
// @fixture llm-ready
// The Codex and Claude Code CLI runs (lab Steps 2 and 6) are not performed here; the lab says so and
// words their results as "you should see". This spec checks the endpoints the CLIs use.
// The Anthropic part needs ANTHROPIC_API_KEY in setup/.env and is skipped without it.
import { expect, test, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { HAS_ANTHROPIC, lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'connect-coding-agents');

test.describe.configure({ mode: 'serial' });

const CLAUDE = 'claude-haiku-4-5-20251001';
const NO_KEY = 'ANTHROPIC_API_KEY is not set in setup/.env; the lab marks the Anthropic part optional';

/** Picks an Integration in Client Setup and returns the snippet area. */
async function integration(page: Page, name: string) {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Integration' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(main.getByRole('combobox', { name: 'Integration' })).toHaveText(name);
  return main;
}

test('Codex: snippet in Client Setup', async ({ page }) => {
  await go(page, '/llm/client-setup');
  const main = page.locator('main');
  await main.getByPlaceholder('Select or type a model').fill('gpt-4o-mini');
  await main.getByRole('combobox', { name: 'Integration' }).click();
  await shot(page, '01-integration-list', page.getByRole('option', { name: 'Codex CLI', exact: true }));
  await page.getByRole('option', { name: 'Codex CLI', exact: true }).click();
  await expect(main).toContainText('codex --model "openai/gpt-4o-mini"');
  await expect(main).toContainText(`model_providers.gateway.base_url="http://localhost:4000/v1"`);
  await shot(page, '02-codex-snippet', main.getByRole('button', { name: 'Copy' }));
});

test('Codex: the Responses API answers through the gateway', async () => {
  const r = sh(`curl -s -w '\\nHTTP %{http_code}' http://localhost:4000/v1/responses \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"openai/gpt-4o-mini","input":"Reply with the single word: ready"}'`);
  expect(r.stdout).toMatch(/\nHTTP 200$/);
  const body = JSON.parse(r.stdout.replace(/\nHTTP \d+$/, ''));
  expect(body.object).toBe('response');
  expect(body.status).toBe('completed');
});

test('Claude Code: add the Anthropic provider', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await go(page, '/llm/providers');
  const add = page.getByRole('button', { name: 'Add provider' }).first();
  await shot(page, '03-providers-empty', add);
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('openai-prod').fill('anthropic');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('ANTHROPIC_API_KEY');
  await shot(page, '04-add-provider', d.getByRole('button', { name: 'Save provider' }));
  await save(page, 'Save provider');

  await expect(page.locator('main').getByRole('row', { name: /anthropic/ })).toBeVisible();
  expect(readConfig().llm.providers).toEqual([{ name: 'anthropic', provider: 'anthropic', params: { apiKey: '$ANTHROPIC_API_KEY' } }]);
});

test('Claude Code: add the Claude Haiku model', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: /^anthropic\s*configured/ }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill(CLAUDE);
  await expect(d.getByRole('button', { name: 'Incoming model', exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Incoming model', exact: true }).click();
  await shot(page, '05-add-claude-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  const m = readConfig().llm.models.find((x: any) => x.name === CLAUDE);
  expect(m).toEqual({ name: CLAUDE, provider: { reference: 'anthropic' } });
});

test('Claude Code: the Messages API answers through the gateway', async () => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await new Promise((r) => setTimeout(r, 2000));
  const r = sh(`curl -s -w '\\nHTTP %{http_code}' http://localhost:4000/v1/messages \\
    -H 'Content-Type: application/json' \\
    -H 'anthropic-version: 2023-06-01' \\
    -d '{"model":"${CLAUDE}","max_tokens":64,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}'`);
  expect(r.stdout).toMatch(/\nHTTP 200$/);
  const body = JSON.parse(r.stdout.replace(/\nHTTP \d+$/, ''));
  expect(body.type).toBe('message');
  expect(body.role).toBe('assistant');
});

test('Claude Code: snippet in Client Setup', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await go(page, '/llm/client-setup');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: CLAUDE }).first().click();
  await integration(page, 'Claude Code');
  await expect(main).toContainText('export ANTHROPIC_BASE_URL="http://localhost:4000"');
  await expect(main).toContainText(`claude --model "${CLAUDE}"`);
  await shot(page, '06-claude-code-snippet', main.getByRole('button', { name: 'Copy' }));
});

test('clean up: delete the Claude model and the Anthropic provider', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await go(page, '/llm/models');
  const row = page.locator('main').getByRole('row').filter({ has: page.getByText(CLAUDE, { exact: true }) });
  await row.getByRole('button', { name: 'Delete model' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete model' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);

  await go(page, '/llm/providers');
  const prow = page.locator('main').getByRole('row').filter({ hasText: 'anthropic' });
  const del = prow.getByRole('button', { name: 'Delete provider' });
  await shot(page, '07-delete-provider', del);
  await del.click();
  // The UI asks "Delete anthropic? This cannot be undone."
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete provider' }).click();
  await expect(prow).toHaveCount(0);
  await page.waitForTimeout(1000);

  const cfg = readConfig();
  expect(cfg.llm.providers ?? []).toEqual([]);
  expect(cfg.llm.models.map((m: any) => m.name)).toEqual(['openai/*']);
});
