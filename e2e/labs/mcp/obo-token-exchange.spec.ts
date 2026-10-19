// labs/mcp/obo-token-exchange.md
// @fixture mcp-ready
// @profiles keycloak,obo
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('mcp', 'obo-token-exchange');
const ISSUER = 'http://localhost:8180/realms/workshop';
const EXCHANGE = `oauthTokenExchange:
  host: localhost:8180
  path: /realms/workshop/protocol/openid-connect/token
  audiences:
  - procurement-api
  clientAuth:
    method: clientSecretBasic
    clientId: agentgateway
    clientSecret: workshop-gateway-secret`;

// The lab's commands, as written.
const GET_TOKEN = `TOKEN=$(curl -s http://localhost:8180/realms/workshop/protocol/openid-connect/token \\
  -d grant_type=password -d client_id=workshop-cli \\
  -d username=alice -d password=workshop \\
  | sed -E 's/.*"access_token":"([^"]+)".*/\\1/')`;
const CALL = `curl -s http://localhost:8080/orders -H "Authorization: Bearer $TOKEN" \\
  | tr -d ' \\n' | grep -o '"payload":{[^}]*}'`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await expect(async () => {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(r.status).toBe(200);
  }).toPass({ timeout: 180_000, intervals: [2000] });
});

async function pasteInto(page: Page, editor: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(800);
  // Click outside the editor to close its suggestion list.
  await page.locator('aside.drawer.nested').getByRole('heading', { level: 3 }).click();
}

function payload(): string {
  const r = sh(`${GET_TOKEN}\n${CALL}`).stdout.trim();
  console.log(r);
  return r;
}

test('add the public gateway and a route to the API', async ({ page }) => {
  await go(page, '/traffic/gateways');
  await page.locator('main').getByRole('button', { name: 'Add gateway' }).first().click();
  let d = page.getByRole('dialog');
  await expect(d.getByRole('textbox', { name: /^Name/ })).toHaveValue('public');
  await expect(d.getByRole('textbox', { name: /^Port/ })).toHaveValue('8080');
  await shot(page, '01-add-gateway', d.getByRole('button', { name: 'Save gateway' }));
  await save(page, 'Save gateway');

  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Gateway' }).click();
  await page.getByRole('option', { name: /^public/ }).click();
  await d.getByRole('textbox', { name: /^Name/ }).fill('procurement-api');
  await d.getByRole('button', { name: 'Add backend' }).click();
  await d.getByRole('textbox', { name: 'Host', exact: true }).fill('procurement-api:8000');
  await shot(page, '02-add-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  expect(readConfig().routes[0].backends).toEqual([{ host: 'procurement-api:8000' }]);
});

test('without exchange, the API gets the user token as is', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const p = payload();
  expect(p).toContain('"aud":"agentgateway"');
  expect(p).toContain('"azp":"workshop-cli"');
  expect(p).toContain('"preferred_username":"alice"');
});

test('add token exchange to the backend', async ({ page }) => {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('row', { name: /^procurement-api\b/ }).getByRole('button', { name: 'Edit route' }).click();
  const d = page.getByRole('dialog');
  const bp = d.getByRole('button', { name: /^Backend policies/ });
  await shot(page, '03-backend-policies', bp);
  await bp.click();
  // Backend policies open in a second drawer on top of the route.
  const nested = page.locator('aside.drawer.nested');
  const auth = nested.getByRole('button', { name: /^(enabled|disabled)?\s*Backend auth\b/ }).first();
  await shot(page, '04-backend-auth', auth);
  await auth.click();
  await nested.getByRole('combobox', { name: 'Auth method' }).click();
  await page.getByRole('option', { name: /^Raw YAML/ }).click();
  await page.waitForTimeout(800);
  console.log(await nested.ariaSnapshot());
  await pasteInto(page, nested.locator('.monaco-editor:visible').first(), EXCHANGE);
  const inner = nested.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '05-exchange-yaml', inner);
  await inner.click();
  await page.waitForTimeout(800);
  console.log((await nested.innerText()).slice(0, 300));
  await nested.getByRole('button', { name: 'Close' }).click();
  await save(page, 'Save route');
  const b = readConfig().routes[0].backends[0];
  console.log(JSON.stringify(b));
  expect(b.policies.backendAuth.oauthTokenExchange.audiences).toEqual(['procurement-api']);
});

test('check it: the API gets an exchanged token', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const p = payload();
  expect(p).toContain('"aud":"procurement-api"');
  expect(p).toContain('"azp":"agentgateway"');
  expect(p).toContain('"preferred_username":"alice"');
  // Without a user token, the gateway has nothing to exchange and does not call the API.
  const anon = sh(`curl -s -w '\\nHTTP %{http_code}\\n' http://localhost:8080/orders`).stdout;
  console.log(`no token: ${anon}`);
  expect(anon).toContain('HTTP 400');
});

test('clean up', async ({ page }) => {
  await go(page, '/traffic/routes');
  const row = page.locator('main').getByRole('row', { name: /^procurement-api\b/ });
  await row.getByRole('button', { name: 'Delete route' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);
  await go(page, '/traffic/gateways');
  const gw = page.locator('main').getByRole('heading', { name: 'public' });
  await gw.locator('xpath=../..').getByRole('button', { name: 'Delete gateway' }).click();
  await expect(gw).toHaveCount(0);
  await page.waitForTimeout(1000);
});
