// labs/mcp/mcp-opa-authorization.md
// @fixture base
// @profiles opa
// @docker yes
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { helperLogs, lab, labSh } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { mcpConnect } from '../../lib/mcp';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-opa-authorization');
const MCP = 'http://localhost:4001/mcp';
const ALICE = readFileSync('/repo/lib/jwt/tokens/alice.jwt', 'utf8').trim();
const BOB = readFileSync('/repo/lib/jwt/tokens/bob.jwt', 'utf8').trim();
const NO_TOKEN = 'denied by OPA: send a valid workshop token';
const BOB_DENIED = 'denied by OPA: team marketing may not call tool get_full_page';
const PAGE_URL = 'https://docs.solo.io/agentgateway/latest/';
// The first heading of that page. The tool description does not contain it.
const PAGE_TEXT = '# Solo Enterprise for agentgateway latest (Kubernetes)';

// The lab's optional curl.
const CURL = `TOKEN=$(cat ../lib/jwt/tokens/bob.jwt)
SESSION=$(curl -si http://localhost:4001/mcp \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \\
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\\r')
curl -si http://localhost:4001/mcp \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Mcp-Session-Id: $SESSION" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_full_page","arguments":{"url":"${PAGE_URL}"}}}'`;

test.describe.configure({ mode: 'serial' });

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

/** Opens the Tool Playground, optionally pastes a token, and clicks Initialize. */
async function initialize(page: Page, token?: string, shotName?: string) {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  if (token) {
    await main.getByText('Authorization header', { exact: true }).click();
    await main.getByPlaceholder('Optional token').fill(token);
  }
  const init = main.getByRole('button', { name: 'Initialize' });
  if (shotName) await shot(page, shotName, init);
  await init.click();
  await expect(main.getByText(/tools discovered|MCP request failed/).first()).toBeVisible({ timeout: 30_000 });
  return main;
}

/** Selects a tool, fills its arguments, clicks Call tool, and returns the Result panel text. */
async function callTool(page: Page, tool: string, fill: (page: Page) => Promise<void>, shotName?: string) {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: new RegExp(`^${tool}\\b`) }).first().click();
  await fill(page);
  const call = main.getByRole('button', { name: 'Call tool' });
  if (shotName) await shot(page, shotName, call);
  const result = main.getByRole('heading', { name: 'Result', exact: true }).locator('xpath=../..');
  const before = await result.innerText();
  const resp = page.waitForResponse((r) => r.url().includes(':4001/mcp') && r.request().method() === 'POST' && r.request().postData()?.includes('tools/call') === true, { timeout: 60_000 });
  await call.click();
  const r = await resp;
  console.log(`--- ${tool}: HTTP ${r.status()}`);
  await expect.poll(async () => (await main.innerText()) !== before, { timeout: 60_000 }).toBeTruthy();
  await page.waitForTimeout(1000);
  const text = await main.innerText();

  return { status: r.status(), text };
}

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('add the External authz policy', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'External authz');
  await shot(page, '01-policies', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Host' }).fill('opa:9000');
  await expect(d.getByRole('combobox', { name: 'Protocol' })).toHaveText('gRPC');
  await expect(d.getByRole('combobox', { name: 'Failure mode' })).toHaveText('Deny');
  await d.getByText('Include request body').click();
  await d.getByRole('spinbutton', { name: 'Max request bytes' }).or(d.getByRole('textbox', { name: 'Max request bytes' })).fill('8192');
  await shot(page, '02-extauthz-form', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'External authz')).toContainText('enabled');

  const p = readConfig().mcp.policies.extAuthz;
  console.log(JSON.stringify(p));
  expect(p.host).toBe('opa:9000');
  expect(p.failureMode).toBe('deny');
  expect(p.includeRequestBody.maxRequestBytes).toBe(8192);
});

test('Tool Playground without a token is denied', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await initialize(page);
  await expect(main).toContainText(NO_TOKEN);
  await expect(main).toContainText('not initialized');
  await shot(page, '03-no-token', main.getByText('MCP request failed'));
});

test('bob is denied get_full_page but can call search', async ({ page }) => {
  const main = await initialize(page, BOB, '04-bob-token');
  await expect(main).toContainText('3 tools discovered');

  const r = await callTool(page, 'get_full_page', async () => {
    await main.getByRole('textbox', { name: /url/ }).fill(PAGE_URL);
  }, '05-bob-get-full-page');
  expect(r.status).toBe(403);
  await expect(main).toContainText(BOB_DENIED);
  await expect(main).not.toContainText(PAGE_TEXT);
  await shot(page, '06-bob-denied', main.getByText(BOB_DENIED).first());

  const s = await callTool(page, 'search', async (p) => {
    await main.getByRole('textbox', { name: /query/ }).fill('What is agentgateway?');
    await main.getByRole('combobox', { name: 'product' }).click();
    await p.getByRole('option', { name: 'solo-enterprise-for-agentgateway' }).click();
  });
  expect(s.status).toBe(200);
  const hit = main.getByText(/Result 1 \(Score/).first();
  await expect(hit).toBeVisible();
  await expect(main).not.toContainText('MCP request failed');
  await shot(page, '07-bob-search', hit);
});

test('alice can call get_full_page', async ({ page }) => {
  const main = await initialize(page, ALICE);
  await expect(main).toContainText('3 tools discovered');
  const r = await callTool(page, 'get_full_page', async () => {
    await main.getByRole('textbox', { name: /url/ }).fill(PAGE_URL);
  });
  expect(r.status).toBe(200);
  await expect(main).not.toContainText('MCP request failed');
  const out = main.getByText(PAGE_TEXT).first();
  await expect(out).toBeVisible();
  await shot(page, '08-alice-allowed', out);

  // The policy also checks direct clients, not only the playground.
  const bob = await mcpConnect(MCP, BOB);
  expect(bob.status).toBe(200);
  expect((await bob.call('get_full_page', { url: PAGE_URL })).text).toContain(BOB_DENIED);
  const alice = await mcpConnect(MCP, ALICE);
  expect((await alice.call('get_full_page', { url: PAGE_URL })).text).toContain(PAGE_TEXT);
});

test('the OPA decision log', async () => {
  // What the lab's `docker compose logs opa | grep -o '"result":{"allowed":false[^}]*}'` prints.
  const log = helperLogs('opa');
  const lines = (log.match(/"result":\{"allowed":false[^}]*\}/g) ?? []).join('\n');
  console.log(lines);
  expect(lines).toContain('"result":{"allowed":false,"body":"denied by OPA: send a valid workshop token\\n","http_status":403}');
  expect(lines).toContain('"result":{"allowed":false,"body":"denied by OPA: team marketing may not call tool get_full_page\\n","http_status":403}');
  expect(log).toContain('"result":{"allowed":true}');
  expect(log).toMatch(/"parsed_body":\{[^}]*"method":"tools\/call"/);
});

test('optional curl: bob calls get_full_page', async () => {
  const out = labSh(CURL).stdout;
  console.log(out);
  expect(out).toMatch(/^HTTP\/1\.1 403 Forbidden/m);
  expect(out.trimEnd().endsWith(BOB_DENIED)).toBeTruthy();
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '09-turn-off-mcp', save));
});
