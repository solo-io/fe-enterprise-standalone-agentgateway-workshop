// labs/platform/postgres-backend.md
// @fixture base
// @profiles postgres
// @docker yes
// @restarts gateway
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, helper, inLab, lab, labExec, labSh } from '../../lib/lab';
import { addOpenAIModel } from '../../lib/setup';

const { go, shot, save } = lab('platform', 'postgres-backend');

test.describe.configure({ mode: 'serial' });

// The second gateway shares the first one's network, so the test browser reaches it at localhost:15100.
const UI2 = 'http://localhost:15100/ui';

// Clean up changes these lines back in a text editor.
const POSTGRES_URL = '    url: postgres://agentgateway:agentgateway@postgres:5432/agentgateway\n';
const SQLITE_URL = '    url: sqlite:///config/data.db\n';
const STORAGE = '  storage:\n    mode: hybrid\n';
const POSTGRES = `  database:
    url: postgres://agentgateway:agentgateway@postgres:5432/agentgateway
  storage:
    mode: hybrid`;

async function runtime(admin = 'http://localhost:15000'): Promise<any> {
  try {
    return await (await fetch(`${admin}/api/runtime`)).json();
  } catch {
    return {};
  }
}

/** Waits until the gateway answers with this config store mode after a restart. */
async function waitForStore(mode: string, admin?: string): Promise<void> {
  await expect.poll(async () => (await runtime(admin)).ui?.configStoreMode, { timeout: 60_000 }).toBe(mode);
}

async function go2(page: Page, path: string): Promise<void> {
  await page.goto(UI2 + path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Loading permissions');
}

test('before you start: Postgres runs, the second gateway is stopped', async () => {
  // The harness starts the whole postgres profile; the reader starts agentgateway-2 only in Step 4.
  helper('stop', 'agentgateway-2');
  inLab('env UID=$(id -u) GID=$(id -g) docker compose --profile postgres up -d --wait postgres');
  const r = labExec('docker compose exec postgres pg_isready -U agentgateway');
  expect(r.stdout).toContain('accepting connections');
});

test('step 1: point the gateway at Postgres in Raw Configuration', async ({ page }) => {
  await go(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  await expect(editor).toBeVisible();
  // The editor shows config.yaml without the comment lines at the top.
  const lines = readFileSync('/work/config.yaml', 'utf8').split('\n');
  while (lines.length && (lines[0].startsWith('#') || lines[0] === '')) lines.shift();
  const start = lines.findIndex((l) => l === '  database:');
  expect(lines[start + 1]).toBe('    url: sqlite:///config/data.db');
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  // The reader selects both lines in full, from the left edge, and pastes the new block over them.
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await shot(page, '01-raw-config-database', editor);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), POSTGRES + '\n');
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(800);
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '02-raw-config-postgres', saveBtn);
  await saveBtn.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const cfg = readConfig().config;
  expect(cfg.database.url).toBe('postgres://agentgateway:agentgateway@postgres:5432/agentgateway');
  expect(cfg.storage.mode).toBe('hybrid');
  // The gateway reads database and storage only at startup.
  expect((await runtime()).ui.configStoreMode).toBe('file');
});

test('step 2: restart the gateway', async ({ page }) => {
  inLab('docker compose restart agentgateway');
  helper('restart', 'agentgateway');
  await waitForStore('hybrid');
  await go(page, '/raw-config');
  await shot(page, '03-raw-config-hybrid');
  // In hybrid mode the UI does not save config.yaml: Save stays off after an edit.
  const editor = page.locator('main .monaco-editor').first();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('# edit');
  await page.waitForTimeout(500);
  await expect(page.locator('main').getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+Z');
  await page.locator('main').getByRole('tab', { name: 'Database' }).click();
  await shot(page, '04-raw-config-database-tab');
});

test('step 3: add the OpenAI model and chat', async ({ page }) => {
  await addOpenAIModel(page);
  // The model went to Postgres, not to config.yaml.
  expect(readConfig().llm.models ?? []).toEqual([]);
  await go(page, '/llm/models');
  const row = page.locator('main tbody tr').filter({ hasText: 'openai/*' }).first();
  await expect(row).toContainText('Database');
  await shot(page, '05-models-database', row);

  await go(page, '/llm/playground');
  const reply = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: 'Reply with exactly: PONG-1' });
  expect(reply).toContain('PONG-1');
  await shot(page, '06-chat', page.locator('.chat-message.assistant').last());

  await go(page, '/llm/logs');
  const log = page.locator('main tbody tr').filter({ hasText: 'openai/gpt-6-luna' }).first();
  await expect(log).toBeVisible({ timeout: 30_000 });
  await expect(log).toContainText('200');
  await shot(page, '07-logs');
});

test('step 4: start a second gateway on the same database', async ({ page }) => {
  helper('start', 'agentgateway-2');
  await waitForStore('hybrid', 'http://localhost:15100');
  await go2(page, '/llm/models');
  const row = page.locator('main tbody tr').filter({ hasText: 'openai/*' }).first();
  await expect(row).toContainText('Database');
  await shot(page, '08-gateway-2-models', row);
});

test('check it: the second gateway serves the model and shares the logs', async ({ page }) => {
  const r = labSh(`curl -s http://localhost:4100/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model": "openai/gpt-6-luna", "messages": [{"role": "user", "content": "Reply with exactly: PONG-2"}]}'`);
  expect(r.stdout).toContain('PONG-2');

  await go(page, '/llm/logs');
  await expect.poll(async () => {
    await page.reload();
    return page.locator('main tbody tr').filter({ hasText: 'openai/gpt-6-luna' }).count();
  }, { timeout: 30_000 }).toBe(2);
  await shot(page, '09-logs-both');

  const q = labExec(`docker compose exec postgres psql -U agentgateway -c "select completed_at, gen_ai_request_model, input_tokens, output_tokens from request_logs where gen_ai_request_model is not null order by completed_at"`);
  console.log(q.stdout);
  expect(q.stdout).toContain('(2 rows)');
  const res = labExec(`docker compose exec postgres psql -U agentgateway -c "select kind, id, revision from agw_config_resources"`);
  console.log(res.stdout);
  expect(res.stdout).toContain('llm.model');
});

test('check it: a change on one gateway reaches the other', async ({ page }) => {
  await go2(page, '/llm/models');
  const row = page.locator('main tbody tr').filter({ hasText: 'openai/*' }).first();
  const del = row.getByRole('button', { name: /^Delete/ });
  await shot(page, '10-gateway-2-delete', del);
  await del.click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete model$/ }).click();
  await expect(page.locator('main tbody tr').filter({ hasText: 'openai/*' })).toHaveCount(0);

  await go(page, '/llm/models');
  await expect.poll(async () => {
    await page.reload();
    return page.locator('main tbody tr').filter({ hasText: 'openai/*' }).count();
  }, { timeout: 15_000 }).toBe(0);
  await shot(page, '11-models-empty');
});

test('clean up', async ({ page }) => {
  inLab('docker compose --profile postgres stop agentgateway-2');
  helper('stop', 'agentgateway-2');
  // The reader makes this change in a text editor: the UI does not save config.yaml in hybrid mode.
  // The UI saved the keys in its own order, so storage is now below modelCatalog.
  const text = readFileSync('/work/config.yaml', 'utf8');
  expect(text).toContain(POSTGRES_URL);
  expect(text).toContain(STORAGE);
  writeFileSync('/work/config.yaml', text.replace(POSTGRES_URL, SQLITE_URL).replace(STORAGE, ''));
  inLab('docker compose restart agentgateway');
  helper('restart', 'agentgateway');
  await waitForStore('file');
  await go(page, '/llm/models');
  await expect(page.locator('main')).not.toContainText('openai/*');
});
