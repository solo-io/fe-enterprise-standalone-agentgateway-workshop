// labs/mcp/local-mcp-and-federation.md
// @fixture base
// @profiles mcp-everything
// @docker yes
import { expect, test, type Locator, type Page } from '@playwright/test';
import { helperLogs, inLab, lab, labSh, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'local-mcp-and-federation');

test.describe.configure({ mode: 'serial' });

/** Opens MCP Servers > Settings, opens the MCP behavior section, and returns the dialog. */
async function openSettings(page: Page): Promise<Locator> {
  await go(page, '/mcp/servers');
  await page.locator('main').getByRole('button', { name: 'Settings' }).click();
  const d = page.getByRole('dialog');
  // The section is closed each time the panel opens.
  const section = d.getByRole('button', { name: /^MCP behavior/ });
  await expect(section).toHaveAttribute('aria-expanded', 'false');
  await section.click();
  await expect(section).toHaveAttribute('aria-expanded', 'true');
  return d;
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
  // The playground reads the MCP address from the gateway config when the page loads.
  await page.waitForLoadState('networkidle');
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

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('add the local MCP server', async ({ page }) => {
  // Wait for the server to answer: npx downloads it when the container starts.
  await expect.poll(() => sh(`curl -s -o /dev/null -w '%{http_code}' http://mcp-everything:3001/mcp`).stdout.trim(),
    { timeout: 180_000, intervals: [2000] }).not.toBe('000');
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

// The lab's optional curl check.
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
  const r = labSh(CURL);
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
  expect(text).toContain('"message":"failed to send message"');
  await shot(page, '10-fail-closed');
  // The response does not say why. The lab reads the reason from the gateway log.
  inLab(`docker compose logs agentgateway | grep 'failed to send message' | tail -1`);
  const line = helperLogs('agentgateway').split('\n').filter((l) => l.includes('failed to send message')).pop() ?? '';
  console.log(`gateway log: ${line}`);
  expect(line).toMatch(/http\.status=500 protocol=mcp mcp\.method\.name=initialize error="mcp: failed to send message: http upstream error: http request failed: backends required DNS resolution which failed"/);
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

test('what the UI wrote', () => {
  const mcp = readConfig().mcp;
  expect(mcp.targets).toEqual([
    { name: 'solo-docs', mcp: { host: 'https://search.solo.io/mcp' } },
    { name: 'everything', mcp: { host: 'http://mcp-everything:3001/mcp' } },
    { name: 'broken', mcp: { host: 'http://does-not-exist:3001/mcp' } },
  ]);
  const { statefulMode, prefixMode, failureMode, toolMode } = mcp;
  expect({ statefulMode, prefixMode, failureMode, toolMode })
    .toEqual({ statefulMode: 'stateless', prefixMode: 'never', failureMode: 'failOpen', toolMode: 'standard' });
  expect(Object.keys(mcp)).toEqual(['gateways', 'targets', 'policies', 'statefulMode', 'prefixMode', 'failureMode', 'toolMode']);
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '13-turn-off-mcp', save));
});
