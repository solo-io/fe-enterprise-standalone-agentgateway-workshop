// labs/mcp/mcp-oauth-keycloak.md
// @fixture base
// @profiles keycloak,mcp-inspector
import { expect, test, type Page } from '@playwright/test';
import { lab } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-oauth-keycloak');
const ISSUER = 'http://localhost:8180/realms/workshop';
const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;
const INSPECTOR = 'http://localhost:6274/?MCP_INSPECTOR_API_TOKEN=workshop';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Keycloak takes up to a minute to import the realm on first start.
  await expect(async () => {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(r.status).toBe(200);
  }).toPass({ timeout: 180_000, intervals: [2000] });
  await expect(async () => {
    const r = await fetch('http://localhost:6274/');
    expect(r.status).toBeLessThan(500);
  }).toPass({ timeout: 120_000, intervals: [2000] });
});

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('turn on MCP authentication with Keycloak', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'MCP authentication');
  await shot(page, '01-policies', card);
  await card.click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('combobox', { name: 'Validation mode' })).toHaveText('Strict');
  await d.getByRole('button', { name: 'Remote URL', exact: true }).click();
  console.log(await d.ariaSnapshot());
  await d.getByRole('textbox', { name: /JWKS URL/ }).fill(JWKS_URL);
  await d.getByRole('textbox', { name: /^Issuer/ }).fill(ISSUER);
  await shot(page, '02-authn', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const a = readConfig().mcp.policies.mcpAuthentication;
  console.log(JSON.stringify(a));
  expect(a.issuer).toBe(ISSUER);
});

test('the Tool Playground has no token and gets 401', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main).toContainText('JWT token required', { timeout: 30_000 });
  await shot(page, '03-no-token', main.getByText('MCP request failed'));
});

test('sign in through MCP Inspector', async ({ page }) => {
  await page.goto(INSPECTOR);
  const sw = page.getByRole('switch', { name: /localhost:4001/ });
  await expect(sw).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-inspector', sw.locator('xpath=..'));
  await sw.click({ force: true });

  await expect(page).toHaveURL(/localhost:8180\/realms\/workshop\//, { timeout: 30_000 });
  await page.getByLabel('Username or email').fill('alice');
  await page.getByLabel('Password', { exact: true }).fill('workshop');
  await shot(page, '05-keycloak-login', page.getByRole('button', { name: 'Sign In' }));
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/localhost:6274/, { timeout: 30_000 });
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-connected', page.getByText('Connected', { exact: true }));

  // The OAuth steps in the Network panel.
  await page.locator('label').filter({ hasText: /^Network$/ }).click();
  await page.waitForTimeout(1000);
  const net = await page.locator('body').innerText();
  // The sign-in steps the lab lists: 401, metadata, Keycloak discovery, registration, token, then MCP with the token.
  for (const s of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server/realms/workshop',
    '/realms/workshop/clients-registrations/openid-connect', '/realms/workshop/protocol/openid-connect/token']) expect(net).toContain(s);
  expect(net).toMatch(/401 UNAUTHORIZED/i);
  expect(net).toMatch(/201 CREATED/i);
  await shot(page, '07-network');

  await page.getByText('Tools', { exact: true }).first().click();
  const main = page.locator('main');
  for (const tool of ['search', 'get_chunks', 'get_full_page']) await expect(main.getByRole('button', { name: tool, exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, '08-tools', main.getByRole('button', { name: 'search', exact: true }));
  await main.getByRole('button', { name: 'search', exact: true }).click();
  await main.getByRole('textbox', { name: 'query' }).fill('MCP authentication');
  await main.getByRole('textbox', { name: 'product' }).click();
  await page.getByRole('option', { name: 'solo-enterprise-for-agentgateway' }).click();
  const run = main.getByRole('button', { name: 'Execute Tool' });
  await shot(page, '09-search-form', run);
  await run.click();
  const result = main.getByText(/Result 1 \(Score/).first();
  await expect(result).toBeVisible({ timeout: 60_000 });
  await shot(page, '10-search-result', result);
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '11-turn-off-mcp', save));
});
