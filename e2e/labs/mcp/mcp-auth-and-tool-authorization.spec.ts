// labs/mcp/mcp-auth-and-tool-authorization.md
// @fixture base
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { mcpConnect } from '../../lib/mcp';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-auth-and-tool-authorization');
const MCP = 'http://localhost:4001/mcp';
const JWKS = readFileSync('/repo/lib/jwt/public-jwks.json', 'utf8').trim();
const ALICE = readFileSync('/repo/lib/jwt/tokens/alice.jwt', 'utf8').trim();
const BOB = readFileSync('/repo/lib/jwt/tokens/bob.jwt', 'utf8').trim();
const RULE = 'mcp.tool.name == "search" && jwt.team == "marketing"';

test.describe.configure({ mode: 'serial' });

/** Replaces the text of a Monaco code editor by pasting, as the reader does. */
async function pasteInto(page: Page, editor: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+V');
}

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

/** Opens the Tool Playground, pastes a token, clicks Initialize, and returns the main area. */
async function initialize(page: Page, token?: string) {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  if (token) {
    await main.getByText('Authorization header', { exact: true }).click();
    await main.getByPlaceholder('Optional token').fill(token);
  }
  await main.getByRole('button', { name: 'Initialize' }).click();
  return main;
}

async function toolOptions(page: Page): Promise<string[]> {
  await page.locator('main').getByRole('combobox', { name: 'Tool' }).click();
  await expect(page.getByRole('option').first()).toBeVisible();
  return page.getByRole('option').allInnerTexts();
}

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('turn on MCP authentication', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'MCP authentication');
  await shot(page, '01-policies', card);
  await card.click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('combobox', { name: 'Validation mode' })).toHaveText('Strict');
  await d.getByRole('button', { name: 'Inline JSON', exact: true }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), JWKS);
  await d.getByRole('textbox', { name: 'Issuer' }).fill('solo-workshop');
  await d.getByPlaceholder('mcp://gateway').fill('agentgateway');
  await d.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(d).not.toContainText('Invalid MCP authentication policy');
  await shot(page, '02-authn', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'MCP authentication')).toContainText('enabled');
});

test('Tool Playground without a token gets 401', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await initialize(page);
  await expect(main).toContainText('JWT token required', { timeout: 30_000 });
  await expect(main).toContainText('not initialized');
  await shot(page, '03-no-token', main.getByText('MCP request failed'));
  const s = await mcpConnect(MCP);
  expect(s.status).toBe(401);
});

test('Tool Playground with the alice token lists all tools', async ({ page }) => {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByText('Authorization header', { exact: true }).click();
  await main.getByPlaceholder('Optional token').fill(ALICE);
  const init = main.getByRole('button', { name: 'Initialize' });
  await shot(page, '04-alice-token', init);
  await init.click();
  await expect(main.getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('3 tools discovered');
  const opts = await toolOptions(page);
  expect(opts.some((o) => o.startsWith('search'))).toBeTruthy();
  await shot(page, '05-alice-tools', page.getByRole('option', { name: /^search/ }).first());
  await page.keyboard.press('Escape');

  const s = await mcpConnect(MCP, ALICE);
  expect(s.status).toBe(200);
  expect(await s.tools()).toEqual(expect.arrayContaining(['search', 'get_chunks', 'get_full_page']));
});

test('add the authorization rule', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'MCP authorization');
  await shot(page, '06-authz-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Add rule' }).first().click();
  await d.getByRole('combobox', { name: 'Rule 1 effect' }).click();
  await page.getByRole('option', { name: /^Deny/ }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), RULE);
  await expect(d).toContainText('- deny: mcp.tool.name == "search" && jwt.team == "marketing"');
  await shot(page, '07-authz-rule', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'MCP authorization')).toContainText('enabled');
});

test('bob does not see search, alice still does', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByText('Authorization header', { exact: true }).click();
  await main.getByPlaceholder('Optional token').fill(BOB);
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('2 tools discovered');
  const opts = await toolOptions(page);
  expect(opts.some((o) => o.startsWith('get_chunks'))).toBeTruthy();
  expect(opts.some((o) => o.startsWith('search'))).toBeFalsy();
  await shot(page, '08-bob-tools', page.getByRole('listbox').first());
  await page.keyboard.press('Escape');

  const bob = await mcpConnect(MCP, BOB);
  const bobTools = await bob.tools();
  expect(bobTools).toEqual(expect.arrayContaining(['get_chunks', 'get_full_page']));
  expect(bobTools).not.toContain('search');
  const call = await bob.call('search', { query: 'agentgateway', product: 'solo-enterprise-for-agentgateway' });
  expect(call.text).toContain('Unknown tool: search');

  // The lab: reload the page, then repeat steps 2 to 5 with alice's token. Alice still sees all 3 tools.
  await page.reload();
  await main.getByText('Authorization header', { exact: true }).click();
  await main.getByPlaceholder('Optional token').fill(ALICE);
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('3 tools discovered');
  const aliceOpts = await toolOptions(page);
  expect(aliceOpts).toHaveLength(3);
  for (const t of ['search', 'get_chunks', 'get_full_page']) expect(aliceOpts.some((o) => o.startsWith(t))).toBeTruthy();
  await page.keyboard.press('Escape');

  const alice = await mcpConnect(MCP, ALICE);
  expect((await alice.tools()).sort()).toEqual(['get_chunks', 'get_full_page', 'search']);
});

test('optional curl checks', async () => {
  const anon = sh(`curl -s -o /dev/null -w '%{http_code}' http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`);
  expect(anon.stdout).toBe('401');
  const withTok = sh(`TOKEN=$(cat /repo/lib/jwt/tokens/alice.jwt)
curl -s -o /dev/null -w '%{http_code}' http://localhost:4001/mcp \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`);
  expect(withTok.stdout).toBe('200');
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '09-turn-off-mcp', save));
});
