// labs/llm/connect-coding-agents.md
// @fixture base
// The Codex and Claude Code CLI runs (lab Steps 2 and 4) are not performed here; the lab says so and
// words their results as "you should see". This spec checks the endpoints the CLIs use.
// The Claude Code part needs ANTHROPIC_API_KEY in setup/.env and is skipped without it. Set up adds
// the openai/* model and, for Claude Code, the anthropic provider and anthropic/* model; the cleanup deletes them.
import { expect, test, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { HAS_ANTHROPIC, lab, labSh } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';

const { go, shot, save } = lab('llm', 'connect-coding-agents');

test.describe.configure({ mode: 'serial' });

const CLAUDE = 'anthropic/claude-haiku-5-5';
const NO_KEY = 'ANTHROPIC_API_KEY in setup/.env is not set or not accepted; the lab marks the Anthropic part optional';

/** Picks an Integration in Client Setup and returns the snippet area. */
async function integration(page: Page, name: string) {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Integration' }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(main.getByRole('combobox', { name: 'Integration' })).toHaveText(name);
  return main;
}

test('set up: add the OpenAI model', async ({ page }) => {
  await addOpenAIModel(page);
});

// Set up, optional part for Claude Code, without screenshots (connect-anthropic captures them).
test('set up: add the Anthropic provider and model', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
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
  expect(readConfig().llm.models.map((m: any) => m.name)).toEqual(['openai/*', 'anthropic/*']);
});

test('Codex: snippet in Client Setup', async ({ page }) => {
  await go(page, '/llm/client-setup');
  const main = page.locator('main');
  await main.getByPlaceholder('Select or type a model').fill('gpt-6-luna');
  await main.getByRole('combobox', { name: 'Integration' }).click();
  await shot(page, '01-integration-list', page.getByRole('option', { name: 'Codex CLI', exact: true }));
  await page.getByRole('option', { name: 'Codex CLI', exact: true }).click();
  await expect(main).toContainText('codex --model "openai/gpt-6-luna"');
  await expect(main).toContainText(`model_providers.gateway.base_url="http://localhost:4000/v1"`);
  await shot(page, '02-codex-snippet', main.getByRole('button', { name: 'Copy' }));
});

test('Codex: the Responses API answers through the gateway', async () => {
  const body = JSON.parse(labSh(`curl -s http://localhost:4000/v1/responses \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"openai/gpt-6-luna","input":"Reply with the single word: ready"}'`).stdout);
  expect(body.object).toBe('response');
  expect(body.status).toBe('completed');
});

test('Claude Code: snippet in Client Setup', async ({ page }) => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  await go(page, '/llm/client-setup');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'anthropic/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('claude-haiku-5-5');
  await integration(page, 'Claude Code');
  await expect(main).toContainText('export ANTHROPIC_BASE_URL="http://localhost:4000"');
  await expect(main).toContainText(`claude --model "${CLAUDE}"`);
  await shot(page, '03-claude-code-snippet', main.getByRole('button', { name: 'Copy' }));
});

test('Claude Code: the Messages API answers through the gateway', async () => {
  test.skip(!HAS_ANTHROPIC, NO_KEY);
  const body = JSON.parse(labSh(`curl -s http://localhost:4000/v1/messages \\
  -H 'Content-Type: application/json' \\
  -H 'anthropic-version: 2023-06-01' \\
  -d '{"model":"${CLAUDE}","max_tokens":1024,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}'`).stdout);
  expect(body.type).toBe('message');
  expect(body.model).toMatch(/^claude-haiku-5-5/);
});

test('clean up: delete the models and the provider', async ({ page }) => {
  // The Anthropic model and provider exist only when the optional Claude Code part ran.
  if (HAS_ANTHROPIC) {
    await go(page, '/llm/models');
    const row = page.locator('main').getByRole('row').filter({ has: page.getByText('anthropic/*', { exact: true }) });
    await row.getByRole('button', { name: 'Delete model' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete model' }).click();
    await expect(row).toHaveCount(0);
    await page.waitForTimeout(1000);
  }
  await deleteModel(page);

  if (HAS_ANTHROPIC) {
    await go(page, '/llm/providers');
    const prow = page.locator('main').getByRole('row').filter({ hasText: 'anthropic' });
    await prow.getByRole('button', { name: 'Delete provider' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete provider' }).click();
    await expect(prow).toHaveCount(0);
    await page.waitForTimeout(1000);
  }

  const cfg = readConfig();
  expect(cfg.llm.providers ?? []).toEqual([]);
  expect(cfg.llm.models ?? []).toEqual([]);
});
