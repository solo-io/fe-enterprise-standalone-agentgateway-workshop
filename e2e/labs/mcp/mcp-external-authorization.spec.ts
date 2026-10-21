// labs/mcp/mcp-external-authorization.md
// @fixture base
// @profiles ext-authz-jwt
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { lab, labSh } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { mcpConnect } from '../../lib/mcp';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-external-authorization');
const MCP = 'http://localhost:4001/mcp';
const ALICE = readFileSync('/repo/lib/jwt/tokens/alice.jwt', 'utf8').trim();
const BOB = readFileSync('/repo/lib/jwt/tokens/bob.jwt', 'utf8').trim();
const NO_TOKEN = 'denied by ext_authz: missing Authorization header';
const BOB_DENIED = 'denied by ext_authz: claim team=marketing does not match required value platform';

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

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('add the External authz policy', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'External authz');
  await shot(page, '01-policies', card);
  await card.click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('textbox', { name: 'Host' })).toHaveValue('127.0.0.1:9000');
  await d.getByRole('textbox', { name: 'Host' }).fill('ext-authz-jwt:9000');
  await expect(d.getByRole('combobox', { name: 'Protocol' })).toHaveText('gRPC');
  await expect(d.getByRole('combobox', { name: 'Failure mode' })).toHaveText('Deny');
  await shot(page, '02-extauthz-form', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'External authz')).toContainText('enabled');

  const p = readConfig().mcp.policies.extAuthz;
  console.log(JSON.stringify(p));
  expect(p.host).toBe('ext-authz-jwt:9000');
  expect(p.failureMode).toBe('deny');
  expect(p.protocol.grpc).toBeTruthy();
});

test('Tool Playground without a token is denied', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await initialize(page);
  await expect(main).toContainText(NO_TOKEN);
  await expect(main).toContainText('not initialized');
  await shot(page, '03-no-token', main.getByText('MCP request failed'));
});

test('alice is allowed', async ({ page }) => {
  const main = await initialize(page, ALICE, '04-alice-token');
  await expect(main).toContainText('3 tools discovered');
  await shot(page, '05-alice-allowed', main.getByText('3 tools discovered'));
  const s = await mcpConnect(MCP, ALICE);
  expect(s.status).toBe(200);
});

test('bob is denied', async ({ page }) => {
  const main = await initialize(page, BOB);
  await expect(main).toContainText(BOB_DENIED);
  await expect(main).toContainText('not initialized');
  await shot(page, '06-bob-denied', main.getByText('MCP request failed'));
  const s = await mcpConnect(MCP, BOB);
  expect(s.status).toBe(403);
});

const INIT = `-H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`;

test('optional curl checks', async () => {
  const anon = labSh(`curl -si http://localhost:4001/mcp \\
  ${INIT}`).stdout;
  console.log(anon);
  expect(anon).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  expect(anon.trimEnd().endsWith(NO_TOKEN)).toBeTruthy();
  const alice = labSh(`TOKEN=$(cat ../lib/jwt/tokens/alice.jwt)
curl -s -o /dev/null -w '%{http_code}\\n' http://localhost:4001/mcp \\
  -H "Authorization: Bearer $TOKEN" \\
  ${INIT}`).stdout;
  expect(alice.trim()).toBe('200');
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '07-turn-off-mcp', save));
});
