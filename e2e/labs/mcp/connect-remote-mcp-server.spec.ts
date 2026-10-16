// labs/mcp/connect-remote-mcp-server.md (foundation lab: ends in mcp-ready)
// @fixture llm-ready
// @expect mcp-ready
import { expect, test } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { mcpConnect } from '../../lib/mcp';

const { go, shot, save } = lab('mcp', 'connect-remote-mcp-server');

test.describe.configure({ mode: 'serial' });

test('enable MCP', async ({ page }) => {
  await go(page, '/');
  // The first "Get started" in the sidebar is under MCP; the second is under Traffic.
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).first();
  await shot(page, '01-sidebar-get-started', start);
  await start.click();
  await expect(page).toHaveURL(/\/ui\/mcp\/get-started/);
  const btn = page.locator('main').getByRole('button', { name: 'Enable', exact: true });
  await shot(page, '02-enable-mcp', btn);
  await btn.click();
  await expect(page).toHaveURL(/\/ui\/mcp\/servers/);
});

test('add the Solo docs MCP server', async ({ page }) => {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /Server name/ }).fill('solo-docs');
  await expect(d.getByRole('radio', { name: 'Streamable HTTP' })).toBeVisible();
  await d.getByRole('textbox', { name: /^URL/ }).fill('https://search.solo.io/mcp');
  await shot(page, '03-add-server', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: /solo-docs/ });
  await expect(row).toContainText('ready', { timeout: 30_000 });
  await shot(page, '04-server-ready', row);
});

test('call a tool in the Tool Playground', async ({ page }) => {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  const cors = main.getByRole('button', { name: 'Apply CORS' });
  await shot(page, '05-apply-cors', cors);
  await cors.click();
  await expect(cors).toBeHidden({ timeout: 15_000 });
  // The reader waits a moment and reloads the page, then clicks Initialize.
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(main).not.toContainText('Loading permissions');
  const init = main.getByRole('button', { name: 'Initialize' });
  const reset = main.getByRole('button', { name: 'Reset' });
  await init.click();
  await expect(reset).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('3 tools discovered');
  await shot(page, '06-initialized', main.getByText('3 tools discovered'));

  await main.getByRole('combobox', { name: 'Tool' }).click();
  const options = await page.getByRole('option').allInnerTexts();
  expect(options.some((o) => o.startsWith('search'))).toBeTruthy();
  await page.getByRole('option', { name: /^search/ }).first().click();
  await main.getByRole('textbox', { name: /query/ }).fill('What is agentgateway?');
  await main.getByRole('combobox', { name: 'product' }).click();
  await page.getByRole('option', { name: 'solo-enterprise-for-agentgateway' }).click();
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '07-call-tool', call);
  await call.click();
  // Search results carry a score and a docs URL; the tool description has neither.
  const firstHit = main.getByText(/Result 1 \(Score/).first();
  await expect(firstHit).toBeVisible({ timeout: 60_000 });
  await expect(main).toContainText('Source: https://docs.solo.io');
  await firstHit.scrollIntoViewIfNeeded();
  await shot(page, '08-tool-result');
});

test('the lab curl starts an MCP session', () => {
  const r = sh(`curl -s -i http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`);
  expect(r.stdout).toContain('HTTP/1.1 200 OK');
  expect(r.stdout.toLowerCase()).toContain('mcp-session-id: ');
  expect(r.stdout).toContain('"name":"Solo.io - Docs MCP"');
});

test('MCP endpoint answers on port 4001', async () => {
  const s = await mcpConnect('http://localhost:4001/mcp');
  expect(s.status).toBe(200);
  expect(await s.tools()).toContain('search');
});
