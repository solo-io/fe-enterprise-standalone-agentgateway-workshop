// labs/mcp/local-mcp-and-federation.md
// @fixture mcp-ready
// @profiles mcp-everything
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('mcp', 'local-mcp-and-federation');

test.describe.configure({ mode: 'serial' });

/** Opens MCP Servers > Settings and returns the dialog. */
async function openSettings(page: Page): Promise<Locator> {
  await go(page, '/mcp/servers');
  await page.locator('main').getByRole('button', { name: 'Settings' }).click();
  return page.getByRole('dialog');
}

/** Picks an option in a Settings dropdown. Options read "<label> <description>". */
async function pick(page: Page, d: Locator, field: string, value: string): Promise<void> {
  await d.getByRole('combobox', { name: field }).click();
  await page.getByRole('option', { name: new RegExp(`^${value}\\s+[A-Z]`) }).click();
  await expect(d.getByRole('combobox', { name: field })).toContainText(value);
}

/**
 * Opens the Tool Playground, clicks Initialize, and returns the Result panel text.
 * With reload, it does what the lab says after a config change: wait two seconds, then reload the page.
 */
async function initialize(page: Page, opts: { reload?: boolean; shotName?: string } = {}): Promise<string> {
  const { reload = false, shotName } = opts;
  await go(page, '/mcp/playground');
  if (reload) {
    await page.waitForTimeout(2000);
    await page.reload();
  }
  const main = page.locator('main');
  const init = main.getByRole('button', { name: 'Initialize' });
  if (shotName) await shot(page, shotName, init);
  await init.click();
  await expect(main.getByText(/tools discovered|MCP request failed/).first()).toBeVisible({ timeout: 30_000 });
  return main.innerText();
}

async function addServer(page: Page, name: string, url: string, shotName: string): Promise<Locator> {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Server name' }).fill(name);
  await d.getByRole('textbox', { name: /^URL/ }).fill(url);
  await shot(page, shotName, d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  return page.locator('main').getByRole('row', { name: new RegExp(`^${name}\\b`) });
}

test('add the local MCP server', async ({ page }) => {
  const row = await addServer(page, 'everything', 'http://mcp-everything:3001/mcp', '01-add-server');
  await expect(row).toContainText('ready', { timeout: 30_000 });
  await shot(page, '02-two-servers');
});

test('see tools from both servers in one session', async ({ page }) => {
  const text = await initialize(page, { shotName: '03-initialize' });
  const main = page.locator('main');
  await expect(main).toContainText('16 tools discovered');
  expect(text).toContain('solo-docs_search');
  expect(text).toContain('everything_echo');

  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: /^everything_echo/ }).click();
  await main.getByRole('textbox', { name: /message/ }).fill('hello from the workshop');
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '04-call-echo', call);
  await call.click();
  // The echo server prefixes its reply with "Echo: "; the prompt alone does not contain it.
  const out = main.getByText('Echo: hello from the workshop').first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await shot(page, '05-echo-result', out);
});

// The lab's optional curl check, run as written.
const CURL = `SESSION=$(curl -s -D - -o /dev/null http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \\
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\\r')
curl -s http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Mcp-Session-Id: $SESSION" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \\
  | grep -o '"name":"[^"]*"'`;

test('optional curl check lists both servers', async () => {
  const r = sh(CURL);
  console.log(r.stdout);
  expect(r.stdout).toContain('"name":"solo-docs_search"');
  expect(r.stdout).toContain('"name":"everything_echo"');
});

test('turn off tool name prefixes', async ({ page }) => {
  const d = await openSettings(page);
  await pick(page, d, 'Prefix mode', 'Never');
  await shot(page, '06-prefix-never', d.getByRole('button', { name: 'Save settings' }));
  await save(page, 'Save settings');
  const text = await initialize(page, { reload: true });
  const main = page.locator('main');
  await expect(main).toContainText('16 tools discovered');
  expect(text).not.toContain('everything_echo');
  expect(text).toMatch(/^echo$/m);
  expect(text).toMatch(/^search$/m);
  await shot(page, '07-unprefixed-tools', main.getByText(/^echo$/).first());
});

test('fail closed: one unreachable server breaks the session', async ({ page }) => {
  const row = await addServer(page, 'broken', 'http://does-not-exist:3001/mcp', '08-add-broken');
  await page.waitForTimeout(3000);
  await expect(row).toContainText('ready');
  await shot(page, '09-broken-state');
  const text = await initialize(page, { reload: true });
  expect(text).toContain('MCP request failed');
  expect(text).toContain('DNS resolution');
  await shot(page, '10-fail-closed');
});

test('fail open: the healthy servers keep working', async ({ page }) => {
  const d = await openSettings(page);
  await pick(page, d, 'Failure mode', 'Fail open');
  await shot(page, '11-fail-open', d.getByRole('button', { name: 'Save settings' }));
  await save(page, 'Save settings');
  await initialize(page, { reload: true });
  const main = page.locator('main');
  await expect(main).toContainText('16 tools discovered');
  await shot(page, '12-fail-open-tools', main.getByText('16 tools discovered'));
});

test('clean up', async ({ page }) => {
  for (const name of ['broken', 'everything']) {
    await go(page, '/mcp/servers');
    const row = page.locator('main').getByRole('row', { name: new RegExp(`^${name}\\b`) });
    await row.getByRole('button', { name: 'Delete server' }).click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete server' });
    if (name === 'broken') await shot(page, '13-delete-server', confirm);
    await confirm.click();
    await expect(row).toBeHidden();
  }
  const d = await openSettings(page);
  await pick(page, d, 'Prefix mode', 'None');
  await pick(page, d, 'Failure mode', 'Fail closed');
  await shot(page, '14-settings-defaults', d.getByRole('button', { name: 'Save settings' }));
  await save(page, 'Save settings');

  // The Settings dialog writes every field, including defaults. Remove those three lines.
  const mcp = readConfig().mcp;
  expect(mcp.statefulMode).toBe('stateless');
  expect(mcp.failureMode).toBe('failClosed');
  expect(mcp.toolMode).toBe('standard');
  await go(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  const first = editor.locator('.view-line', { hasText: 'statefulMode: stateless' });
  await first.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
  await shot(page, '15-raw-config-lines');
  await page.keyboard.press('Delete');
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '16-raw-config-save', saveBtn);
  await save(page, saveBtn);
  const after = readFileSync('/work/config.yaml', 'utf8');
  expect(after).not.toContain('statefulMode');
  expect(after).not.toContain('toolMode');
});
