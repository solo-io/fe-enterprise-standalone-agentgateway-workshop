// labs/platform/ui-access-control-oidc.md
// @fixture base
// @profiles keycloak
import { expect, type Browser, type Page, test } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { expectMatchesFixture, readConfig } from '../../lib/config';
import { addOpenAIModel, deleteModel } from '../../lib/setup';

const { go, shot, save } = lab('platform', 'ui-access-control-oidc');

const PUBLIC_UI = 'http://localhost:8080/ui';
const ISSUER = 'http://localhost:8180/realms/workshop';
const OIDC = {
  issuer: ISSUER,
  clientId: 'agentgateway-ui',
  clientSecret: 'workshop-ui-secret',
  redirectURI: 'http://localhost:8080/oauth/callback',
};
const ROLES = [
  { name: 'platform-admins', group: 'platform-team', preset: 'Admin' },
  { name: 'auditors', group: 'auditors', preset: 'Viewer' },
  { name: 'developers', group: 'developers', preset: 'Self-service' },
];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Keycloak takes up to a minute to import the realm on first start.
  await expect(async () => {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(r.status).toBe(200);
  }).toPass({ timeout: 180_000, intervals: [2000] });
});

/** Signs in on the public gateway in a fresh browser context, the way a new private window does. */
async function signIn(browser: Browser, user: string, opts: { path?: string; shots?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(PUBLIC_UI + (opts.path ?? '/'));
  const sso = page.getByRole('link', { name: 'Sign in with SSO' });
  await expect(sso).toBeVisible();
  if (opts.shots) await shot(page, '07-sign-in-page', sso);
  await sso.click();
  await expect(page).toHaveURL(/localhost:8180\/realms\/workshop\//);
  await page.getByLabel('Username or email').fill(user);
  await page.getByLabel('Password', { exact: true }).fill('workshop');
  if (opts.shots) await shot(page, '08-keycloak-login', page.getByRole('button', { name: 'Sign In' }));
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(new RegExp(`^${PUBLIC_UI}`));
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Loading permissions');
  return page;
}

test('set up', async ({ page }) => {
  await addOpenAIModel(page);
});

test('enable Traffic to add the public gateway', async ({ page }) => {
  await go(page, '/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1).click();
  await page.locator('main').getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
});

test('serve the UI on the public gateway', async ({ page }) => {
  await go(page, '/settings/ui');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Public UI gateway' }).click();
  await page.getByRole('option', { name: /^public/ }).click();
  await save(page, 'Save UI gateway');
  expect(readConfig().ui.gateways).toBe('public');
});

test('add an OIDC policy that signs users in with Keycloak', async ({ page }) => {
  await go(page, '/settings/ui');
  const card = page.locator('main').getByRole('button', { name: /OIDC/ });
  await expect(card).toBeEnabled();
  await shot(page, '01-oidc-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /^Issuer/ }).fill(OIDC.issuer);
  await d.getByRole('textbox', { name: /^Client ID/ }).fill(OIDC.clientId);
  await d.getByRole('textbox', { name: /^Client secret/ }).fill(OIDC.clientSecret);
  await shot(page, '02-oidc-provider-client', d.getByRole('textbox', { name: /^Client secret/ }));
  await d.getByRole('textbox', { name: /^Redirect URI/ }).fill(OIDC.redirectURI);
  await d.getByRole('button', { name: 'profile', exact: true }).click();
  await d.getByRole('button', { name: 'email', exact: true }).click();
  await d.getByRole('heading', { name: 'Scopes' }).scrollIntoViewIfNeeded();
  await shot(page, '03-oidc-redirect-scopes', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const oidc = readConfig().ui.policies.oidc;
  expect(oidc).toMatchObject(OIDC);
  expect(oidc.scopes).toEqual(['profile', 'email']);
});

test('add a role for each Keycloak group', async ({ page }) => {
  await go(page, '/settings/access-control');
  const main = page.locator('main');
  for (const [i, r] of ROLES.entries()) {
    await main.getByRole('button', { name: 'Add role' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('textbox', { name: 'Role name' }).fill(r.name);
    await d.getByRole('combobox', { name: 'Subject 1 type' }).click();
    await page.getByRole('option', { name: 'Group', exact: true }).click();
    await d.getByRole('textbox', { name: 'Subject 1 value' }).fill(r.group);
    await d.getByRole('combobox', { name: 'Preset' }).click();
    await page.getByRole('option', { name: new RegExp(`^${r.preset}\\b`) }).click();
    if (i === 0) await shot(page, '04-group-role', d.getByRole('button', { name: 'Create role' }));
    await save(page, d.getByRole('button', { name: 'Create role' }));
    await expect(main.getByRole('row', { name: `Role ${r.name}`, exact: true })).toBeVisible();
  }
  expect(readConfig().rbac.policies).toEqual(
    ROLES.map((r) => ({ name: r.name, subjects: [{ group: r.group }], preset: r.preset.toLowerCase() })),
  );
});

test('give carol manage access to one model', async ({ page }) => {
  await go(page, '/settings/access-control');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Add role' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Role name' }).fill('openai-model-owners');
  await expect(d.getByRole('combobox', { name: 'Subject 1 type' })).toHaveText('User');
  await d.getByRole('textbox', { name: 'Subject 1 value' }).fill('carol@example.com');
  await d.getByRole('button', { name: 'Add grant' }).click();
  await expect(d.getByRole('combobox', { name: 'Grant 1 resource' })).toHaveText(/LLM models/);
  await d.getByRole('combobox', { name: 'Grant 1 access' }).click();
  await page.getByRole('option', { name: 'Manage', exact: true }).click();
  await d.getByRole('combobox', { name: 'Grant 1 scope' }).click();
  await page.getByRole('option', { name: /^Named/ }).click();
  await d.getByRole('textbox', { name: 'Grant 1 names' }).fill('openai/*');
  await shot(page, '05-model-owner-role', d.getByRole('button', { name: 'Create role' }));
  await save(page, d.getByRole('button', { name: 'Create role' }));
  await expect(main.getByRole('row', { name: 'Role openai-model-owners', exact: true })).toBeVisible();
  expect(readConfig().rbac.policies[3]).toEqual({
    name: 'openai-model-owners',
    subjects: [{ user: 'carol@example.com' }],
    grants: [{ access: 'manage', resource: 'llm.model', scope: { names: ['openai/*'] } }],
  });
});

test('turn on role-based enforcement', async ({ page }) => {
  await go(page, '/settings/access-control');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Access control enforcement' }).click();
  await page.getByRole('option', { name: /^Role-based/ }).click();
  await save(page, main.getByRole('button', { name: 'Save', exact: true }));
  await shot(page, '06-roles-enforced');
  expect(readConfig().rbac.mode).toBe('fine-grained');
});

test('an API call without a session is sent to the sign-in page', async () => {
  // The lab's exact curl. Plain curl gets a 302; only browser-style fetches (sec-fetch-mode: cors) get a 401.
  const r = sh(`curl -s -o /dev/null -w '%{http_code} %{redirect_url}\\n' http://localhost:8080/api/config`);
  expect(r.stdout.trim()).toBe('302 http://localhost:8080/ui/login?returnTo=%2Fapi%2Fconfig');
});

test('alice signs in through Keycloak and gets full access', async ({ browser }) => {
  const page = await signIn(browser, 'alice', { path: '/settings/access-control', shots: true });
  await expect(page.locator('main')).toContainText('Signed in as alice@example.com in platform-team.');
  await shot(page, '09-alice-access-control', page.getByRole('banner').getByText('Alice Admin'));
  const status = await page.evaluate(async () => (await fetch('/api/config')).status);
  expect(status).toBe(200);
});

test('bob can look but not change', async ({ browser }) => {
  const page = await signIn(browser, 'bob', { path: '/llm/models' });
  const main = page.locator('main');
  await expect(main.getByRole('row', { name: /openai\/\*/ })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Edit model' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'Add model' })).toHaveCount(0);
  await shot(page, '10-bob-models');
  await page.goto(PUBLIC_UI + '/raw-config');
  await expect(main).toContainText('You do not have permission to view this page');
  const status = await page.evaluate(async () => (await fetch('/api/config')).status);
  expect(status).toBe(403);
});

test('carol gets self-service plus the openai/* model', async ({ browser }) => {
  const page = await signIn(browser, 'carol');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Virtual API Keys' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Models' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Raw Configuration' })).toBeHidden();
  await shot(page, '11-carol-home', nav);
  await nav.getByRole('link', { name: 'Models' }).click();
  const main = page.locator('main');
  await expect(main.getByRole('row', { name: /openai\/\*/ })).toBeVisible();
  await shot(page, '12-carol-models', main.getByRole('button', { name: 'Edit model' }));
});

test('clean up: roles, OIDC, UI gateway, public gateway', async ({ page }) => {
  const main = page.locator('main');
  await go(page, '/settings/access-control');
  await main.getByRole('combobox', { name: 'Access control enforcement' }).click();
  await page.getByRole('option', { name: /^Off/ }).click();
  await save(page, main.getByRole('button', { name: 'Save', exact: true }));
  for (const name of [...ROLES.map((r) => r.name), 'openai-model-owners']) {
    const row = main.getByRole('row', { name: `Role ${name}`, exact: true });
    await row.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete role' }).click();
    await expect(row).toBeHidden();
  }

  await go(page, '/settings/ui');
  await main.getByRole('button', { name: /OIDC/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
  await page.waitForTimeout(1000);
  await main.getByRole('combobox', { name: 'Public UI gateway' }).click();
  await page.getByRole('option', { name: /^None/ }).click();
  await main.getByRole('button', { name: 'Save UI gateway' }).click();
  await save(page, page.getByText('Change UI gateway?').locator('../..').getByRole('button', { name: 'Save UI gateway' }));

  await go(page, '/traffic/gateways');
  await save(page, main.getByRole('button', { name: 'Delete gateway' }));
  await expect(main).toContainText('No gateways configured');

  // Deleting the gateway leaves `gateways: {}`; the lab deletes that line in Raw Configuration.
  await go(page, '/raw-config');
  const line = page.locator('main .monaco-editor .view-line').filter({ hasText: /^gateways:\s\{\}/ }).first();
  await expect(line).toBeVisible();
  await line.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await save(page, main.getByRole('button', { name: 'Save', exact: true }));
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.isVisible().catch(() => false)) await save(page, confirm);
  expect(readConfig().gateways).toBeUndefined();

  await deleteModel(page);
  expectMatchesFixture('base');
});
