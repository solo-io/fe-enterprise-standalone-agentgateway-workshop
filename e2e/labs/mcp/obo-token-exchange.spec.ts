// labs/mcp/obo-token-exchange.md
// @fixture base
// @profiles keycloak,obo
import { readFileSync } from 'node:fs';
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

// Part B: the agent is the actor. The gateway signs in as the agent's client and adds the agent's token.
const DELEGATION = `oauthTokenExchange:
  host: localhost:8180
  path: /realms/workshop/protocol/openid-connect/token
  audiences:
  - procurement-api
  clientAuth:
    method: clientSecretBasic
    clientId: procurement-agent
    clientSecret: workshop-agent-secret
  actorToken:
    source:
      header:
        name: x-actor-token
    tokenType: urn:ietf:params:oauth:token-type:access_token`;

// The lab's commands, as written.
const GET_TOKEN = `TOKEN=$(curl -s http://localhost:8180/realms/workshop/protocol/openid-connect/token \\
  -d grant_type=password -d client_id=workshop-cli \\
  -d username=alice -d password=workshop \\
  | sed -E 's/.*"access_token":"([^"]+)".*/\\1/')`;
const CALL = `curl -s http://localhost:8080/orders -H "Authorization: Bearer $TOKEN" \\
  | tr -d ' \\n' | grep -o '"payload":{[^}]*}'`;

const GET_USER_TOKEN = `USER_TOKEN=$(curl -s http://localhost:8180/realms/workshop/protocol/openid-connect/token \\
  -d grant_type=password -d client_id=agent-cli \\
  -d username=alice -d password=workshop \\
  | sed -E 's/.*"access_token":"([^"]+)".*/\\1/')`;
const GET_AGENT_TOKEN = `AGENT_TOKEN=$(curl -s http://localhost:8180/realms/workshop/protocol/openid-connect/token \\
  -u procurement-agent:workshop-agent-secret -d grant_type=client_credentials \\
  | sed -E 's/.*"access_token":"([^"]+)".*/\\1/')`;
const CALL_AS_AGENT = `curl -s http://localhost:8080/orders \\
  -H "Authorization: Bearer $USER_TOKEN" -H "x-actor-token: $AGENT_TOKEN" \\
  | tr -d ' \\n' | grep -oE '"(aud|azp|preferred_username)":"[^"]*"|"act":\\{[^}]*\\}'`;

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

test('turn on Traffic and add a route to the API', async ({ page }) => {
  await go(page, '/');
  // The first "Get started" in the sidebar is under MCP; the second is under Traffic.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1).click();
  await expect(page).toHaveURL(/\/ui\/traffic\/get-started/);
  const enable = page.locator('main').getByRole('button', { name: 'Enable', exact: true });
  await shot(page, '01-enable-traffic', enable);
  await enable.click();
  await expect(page).toHaveURL(/\/ui\/traffic\/gateways/);
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Port 8080');
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });

  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  const d = page.getByRole('dialog');
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

test('Part B: switch the exchange to delegation', async ({ page }) => {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('row', { name: /^procurement-api\b/ }).getByRole('button', { name: 'Edit route' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Backend policies/ }).click();
  const nested = page.locator('aside.drawer.nested');
  await nested.getByRole('button', { name: /^(enabled|disabled)?\s*Backend auth\b/ }).first().click();
  await expect(nested.getByRole('combobox', { name: 'Auth method' })).toContainText('Raw YAML');
  await pasteInto(page, nested.locator('.monaco-editor:visible').first(), DELEGATION);
  const inner = nested.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '06-delegation-yaml', inner);
  await inner.click();
  await page.waitForTimeout(800);
  await nested.getByRole('button', { name: 'Close' }).click();
  await save(page, 'Save route');
  const x = readConfig().routes[0].backends[0].policies.backendAuth.oauthTokenExchange;
  expect(x.clientAuth.clientId).toBe('procurement-agent');
  expect(x.actorToken).toEqual({ source: { header: { name: 'x-actor-token' } }, tokenType: 'urn:ietf:params:oauth:token-type:access_token' });
});

test('Part B check it: the API gets a delegated token', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const out = sh(`${GET_USER_TOKEN}\n${GET_AGENT_TOKEN}\n${CALL_AS_AGENT}`).stdout.trim();
  console.log(out);
  expect(out.split('\n')).toEqual([
    '"aud":"procurement-api"',
    '"azp":"procurement-agent"',
    expect.stringMatching(/^"act":\{"sub":"[0-9a-f-]{36}","client_id":"procurement-agent"\}$/),
    '"preferred_username":"alice"',
  ]);

  // Without the agent's token, the gateway has no actor to send and does not call the API.
  const noActor = sh(`${GET_USER_TOKEN}
curl -s -w '\\nHTTP %{http_code}\\n' http://localhost:8080/orders -H "Authorization: Bearer $USER_TOKEN"`).stdout;
  console.log(`no actor: ${noActor}`);
  expect(noActor).toContain('invalid request\nHTTP 400');

  // An actor alice did not authorize: Keycloak refuses the exchange.
  const other = sh(`${GET_USER_TOKEN}
OTHER_TOKEN=$(curl -s http://localhost:8180/realms/workshop/protocol/openid-connect/token \\
  -u agentgateway:workshop-gateway-secret -d grant_type=client_credentials \\
  | sed -E 's/.*"access_token":"([^"]+)".*/\\1/')
curl -s -w '\\nHTTP %{http_code}\\n' http://localhost:8080/orders \\
  -H "Authorization: Bearer $USER_TOKEN" -H "x-actor-token: $OTHER_TOKEN"`).stdout;
  console.log(`other actor: ${other}`);
  expect(other).toContain('token exchange returned status 403 Forbidden\nHTTP 500');
});

/**
 * Turns Traffic off, as in the lab's cleanup: in Raw Configuration, selects from the line `gateways:`
 * to the end of the file (the `public` gateway and the route), deletes it and saves.
 * Deleting the route and the gateway in the UI leaves `gateways: {}` and `routes: []`, and Traffic stays on.
 */
async function turnOffTraffic(page: Page) {
  const lines = readFileSync('/work/config.yaml', 'utf8').replace(/\n+$/, '').split('\n');
  while (lines.length && (lines[0].startsWith('#') || lines[0] === '')) lines.shift();
  const top = lines.map((l) => (/^[a-zA-Z]/.test(l) ? l.replace(/:.*/, '') : null)).filter(Boolean);
  expect(top.slice(-2), 'gateways and routes must be the last top-level sections').toEqual(['gateways', 'routes']);
  const start = lines.findIndex((l) => l.startsWith('gateways:'));

  await go(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('ControlOrMeta+Shift+End');
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '07-turn-off-traffic', saveBtn);
  await page.keyboard.press('Delete');
  await saveBtn.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  expect(readFileSync('/work/config.yaml', 'utf8')).not.toMatch(/^(gateways|routes):/m);
}

test('clean up: turn off Traffic', async ({ page }) => {
  await turnOffTraffic(page);
  await go(page, '/');
  // With Traffic off, the sidebar shows Get started under Traffic again.
  await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' })).toHaveCount(2);
});
