// labs/platform/ui-access-control.md
// @fixture base
import { expect, type Browser, type Page, test } from '@playwright/test';
import { lab, labSh, sh } from '../../lib/lab';
import { expectMatchesFixture, readConfig } from '../../lib/config';

const { go, shot, save } = lab('platform', 'ui-access-control');

const PUBLIC_UI = 'http://localhost:8080/ui';
const PASSWORD = 'workshop';
const BASIC_AUTH = `mode: strict
realm: agentgateway-ui
htpasswd:
  file: /config/ui-users.htpasswd`;
// No trailing newline: copying a code block from GitHub leaves it off.
const USER_ATTRIBUTE = `  standardAttributes:
    user: basicAuth.username`;
const ROLES = [
  { name: 'platform-admins', user: 'alice', preset: 'Admin' },
  { name: 'auditors', user: 'bob', preset: 'Viewer' },
  { name: 'developers', user: 'carol', preset: 'Self-service' },
];

test.describe.configure({ mode: 'serial' });

/** Opens the UI on the public gateway as one user, the way a fresh private browser window does. */
async function signIn(browser: Browser, user: string, path = '/'): Promise<Page> {
  const ctx = await browser.newContext({
    httpCredentials: { username: user, password: PASSWORD },
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  const page = await ctx.newPage();
  await page.goto(PUBLIC_UI + path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Loading permissions');
  return page;
}

/** Replaces the text of a code editor field the way a reader does: select all, then paste. */
async function pasteInto(page: Page, text: string, marker: string): Promise<void> {
  const editor = page.getByRole('dialog').locator('.monaco-editor').first();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(async () => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await editor.locator('.view-lines').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(editor).toContainText(marker, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

function curlStatus(user?: string, path = '/api/config'): string {
  const auth = user ? `-u ${user}:${PASSWORD} ` : '';
  return sh(`curl -s -o /dev/null -w '%{http_code}' ${auth}http://localhost:8080${path}`).stdout.trim();
}

/** The first Raw Configuration editor line that contains `text`. */
function rawLine(page: Page, text: string | RegExp) {
  return page.locator('main .monaco-editor .view-line').filter({ hasText: text }).first();
}

/** Deletes one Raw Configuration editor line, the way a reader selects the line and presses Delete. */
async function deleteLine(page: Page, text: string | RegExp): Promise<void> {
  const line = rawLine(page, text);
  await expect(line).toBeVisible();
  await line.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(rawLine(page, text)).toHaveCount(0);
}

test('use the Basic auth user name as the user', async ({ page }) => {
  await go(page, '/raw-config');
  const llm = rawLine(page, 'llm:');
  await expect(llm).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), USER_ATTRIBUTE);
  // The lab: click before `llm:`, press Enter, click the new empty line, paste.
  await llm.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  // Monaco keeps replacing its line elements while the suggest list opens after Enter,
  // so retry until the `llm:` line holds still long enough to measure.
  let box: { x: number; y: number; height: number } | null = null;
  await expect(async () => {
    box = await rawLine(page, /^llm:/).boundingBox();
    expect(box).not.toBeNull();
  }).toPass({ timeout: 10_000 });
  await page.mouse.click(box!.x + 2, box!.y - box!.height / 2);
  await page.keyboard.press('ControlOrMeta+V');
  await expect(rawLine(page, 'user: basicAuth.username')).toBeVisible();
  await expect(rawLine(page, 'basicAuth.usernamellm:')).toHaveCount(0);
  await shot(page, '01-raw-config', page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  await save(page, page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.isVisible().catch(() => false)) await save(page, confirm);
  expect(readConfig().config.standardAttributes).toEqual({ user: 'basicAuth.username' });
  // `llm:` must stay a top-level key, not nest under standardAttributes.
  expect(readConfig().llm.port).toBe(4000);
});

test('enable Traffic to add the public gateway', async ({ page }) => {
  await go(page, '/');
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1);
  await shot(page, '02-traffic-get-started', start);
  await start.click();
  const enable = page.locator('main').getByRole('button', { name: 'Enable' });
  await expect(enable).toBeVisible();
  await enable.click();
  const gw = page.locator('main').getByRole('heading', { name: 'public' });
  await expect(gw).toBeVisible();
  await expect(page.locator('main')).toContainText('Port 8080');
  await shot(page, '03-public-gateway', gw);
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
});

test('serve the UI on the public gateway', async ({ page }) => {
  await go(page, '/settings/ui');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Public UI gateway' }).click();
  await page.getByRole('option', { name: /^public/ }).click();
  await shot(page, '04-ui-gateway', main.getByRole('button', { name: 'Save UI gateway' }));
  await save(page, 'Save UI gateway');
  expect(readConfig().ui.gateways).toBe('public');
  expect(curlStatus(undefined, '/ui/')).toBe('200');
});

test('require a password with a Basic auth policy', async ({ page }) => {
  await go(page, '/settings/ui');
  const card = page.locator('main').getByRole('button', { name: /Basic auth/ });
  await expect(card).toBeEnabled();
  await shot(page, '05-basic-auth-card', card);
  await card.click();
  await pasteInto(page, BASIC_AUTH, 'ui-users.htpasswd');
  await shot(page, '06-basic-auth-yaml', page.getByRole('dialog').getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().ui.policies.basicAuth).toEqual({
    mode: 'strict',
    realm: 'agentgateway-ui',
    htpasswd: { file: '/config/ui-users.htpasswd' },
  });
  await page.waitForTimeout(1500);
  expect(curlStatus(undefined, '/ui/')).toBe('401');
  expect(curlStatus('alice', '/ui/')).toBe('200');
});

test('add a role for each user', async ({ page }) => {
  await go(page, '/settings/access-control');
  const main = page.locator('main');
  for (const [i, r] of ROLES.entries()) {
    const add = main.getByRole('button', { name: 'Add role' });
    if (i === 0) await shot(page, '07-add-role', add);
    await add.click();
    const d = page.getByRole('dialog');
    await d.getByRole('textbox', { name: 'Role name' }).fill(r.name);
    await expect(d.getByRole('combobox', { name: 'Subject 1 type' })).toHaveText('User');
    await d.getByRole('textbox', { name: 'Subject 1 value' }).fill(r.user);
    await d.getByRole('combobox', { name: 'Preset' }).click();
    await page.getByRole('option', { name: new RegExp(`^${r.preset}\\b`) }).click();
    if (i === 0) await shot(page, '08-new-role', d.getByRole('button', { name: 'Create role' }));
    await save(page, d.getByRole('button', { name: 'Create role' }));
    await expect(main.getByRole('row', { name: `Role ${r.name}`, exact: true })).toBeVisible();
  }
  await shot(page, '09-roles');
  expect(readConfig().rbac.policies).toEqual(
    ROLES.map((r) => ({ name: r.name, subjects: [{ user: r.user }], preset: r.preset.toLowerCase() })),
  );
});

test('turn on role-based enforcement', async ({ page }) => {
  await go(page, '/settings/access-control');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Access control enforcement' }).click();
  await page.getByRole('option', { name: /^Role-based/ }).click();
  const saveBtn = main.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '10-enforcement', saveBtn);
  await save(page, saveBtn);
  expect(readConfig().rbac.mode).toBe('fine-grained');
  await page.waitForTimeout(1500);
  expect(curlStatus('alice')).toBe('200');
  expect(curlStatus('bob')).toBe('403');
  expect(curlStatus('carol')).toBe('403');
});

test('alice turns on API key auth and creates her key', async ({ browser }) => {
  const page = await signIn(browser, 'alice', '/settings/access-control');
  await expect(page.locator('main')).toContainText('Signed in as alice.');
  await shot(page, '11-alice-access-control');
  await page.goto(PUBLIC_UI + '/llm/keys');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Enable API key auth' }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Enable API key auth' }).click();
  await createKey(page, 'alice-key');
});

/** Creates a virtual key and closes the one-time "Copy your new API key" panel. */
async function createKey(page: Page, name: string, shots = false): Promise<void> {
  const main = page.locator('main');
  const btn = main.getByRole('button', { name: 'New key' }).first();
  await expect(btn).toBeVisible();
  if (shots) await shot(page, '13-carol-new-key', btn);
  await btn.click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Name' }).fill(name);
  await d.getByRole('button', { name: 'Save key' }).click();
  const done = page.getByRole('button', { name: 'Done' });
  await expect(done).toBeVisible();
  await done.click();
  await expect(main.getByRole('row', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
}

test('carol sees a short sidebar and only her own key', async ({ browser }) => {
  const page = await signIn(browser, 'carol');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav.getByRole('link', { name: 'Virtual API Keys' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Models' })).toBeHidden();
  await expect(nav.getByRole('link', { name: 'Raw Configuration' })).toBeHidden();
  await shot(page, '12-carol-home', nav);
  await nav.getByRole('link', { name: 'Virtual API Keys' }).click();
  await createKey(page, 'carol-key', true);
  await page.reload();
  const main = page.locator('main');
  await expect(main.getByRole('row', { name: /^carol-key\b/ })).toBeVisible();
  await expect(main.getByRole('row', { name: /^alice-key\b/ })).toBeHidden();
  await shot(page, '14-carol-keys');
  const keys = readConfig().llm.policies.apiKey.keys;
  expect(keys.map((k: any) => [k.metadata.name, k.metadata['agentgateway.dev/owner']])).toEqual([
    ['alice-key', 'alice'],
    ['carol-key', 'carol'],
  ]);
});

test('bob can look at everything but change nothing', async ({ browser }) => {
  const page = await signIn(browser, 'bob', '/llm/keys');
  const main = page.locator('main');
  await expect(main.getByRole('row', { name: /^alice-key\b/ })).toBeVisible();
  await expect(main.getByRole('row', { name: /^carol-key\b/ })).toBeVisible();
  await expect(main.getByRole('button', { name: 'New key' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  await shot(page, '15-bob-keys');
  await page.goto(PUBLIC_UI + '/raw-config');
  await expect(main).toContainText('You do not have permission to view this page');
  await shot(page, '16-bob-raw-config');
});

test('the admin port keeps full access', async ({ page }) => {
  await go(page, '/settings/access-control');
  await expect(page.locator('main')).toContainText('Connected through the admin interface, which always has full access.');
  await shot(page, '17-admin-interface');

  // The lab's optional curl check.
  const out = labSh(`for u in alice bob carol; do
  echo "$u: $(curl -s -o /dev/null -w '%{http_code}' -u $u:workshop http://localhost:8080/api/config)"
done
echo "no password: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/config)"`).stdout;
  expect(out.trim()).toBe('alice: 200\nbob: 403\ncarol: 403\nno password: 401');
});

test('clean up: keys, roles, Basic auth, UI gateway, public gateway', async ({ page }) => {
  const main = page.locator('main');
  await go(page, '/llm/keys');
  for (const name of ['alice-key', 'carol-key']) {
    const row = main.getByRole('row', { name: new RegExp(`^${name}\\b`) });
    await row.getByRole('button', { name: 'Delete key' }).click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete key' }).click();
    await expect(row).toBeHidden();
  }
  await main.getByRole('button', { name: 'Disable API Key Policy' }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Disable API Key Policy' }).click();
  await expect(main.getByRole('button', { name: 'Enable API key auth' }).first()).toBeVisible();

  await go(page, '/settings/access-control');
  await main.getByRole('combobox', { name: 'Access control enforcement' }).click();
  await page.getByRole('option', { name: /^Off/ }).click();
  await save(page, main.getByRole('button', { name: 'Save', exact: true }));
  expect(readConfig().rbac.mode ?? 'coarse').toBe('coarse');
  for (const r of ROLES) {
    const row = main.getByRole('row', { name: `Role ${r.name}`, exact: true });
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: /Delete/ }).last();
    if (r === ROLES[0]) await shot(page, '18-delete-role', confirm);
    await confirm.click();
    await expect(row).toBeHidden();
  }
  await page.waitForTimeout(1000);
  expect(readConfig().rbac?.policies ?? []).toEqual([]);

  await go(page, '/settings/ui');
  await main.getByRole('button', { name: /Basic auth/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
  await page.waitForTimeout(1000);
  await main.getByRole('combobox', { name: 'Public UI gateway' }).click();
  await page.getByRole('option', { name: /^None/ }).click();
  await main.getByRole('button', { name: 'Save UI gateway' }).click();
  const change = page.getByText('Change UI gateway?').locator('../..').getByRole('button', { name: 'Save UI gateway' });
  await shot(page, '19-change-ui-gateway', change);
  await save(page, change);
  expect(readConfig().ui).toBeUndefined();

  await go(page, '/traffic/gateways');
  await save(page, main.getByRole('button', { name: 'Delete gateway' }));
  await expect(main).toContainText('No gateways configured');

  await go(page, '/raw-config');
  const attr = rawLine(page, 'standardAttributes:');
  await expect(attr).toBeVisible();
  await attr.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(rawLine(page, 'user: basicAuth.username')).toBeHidden();
  await deleteLine(page, /^gateways:\s\{\}/);
  await save(page, page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  const confirm2 = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm2.isVisible().catch(() => false)) await save(page, confirm2);
  // An empty `gateways: {}` keeps Traffic enabled, so the next lab's "Get started" would be missing.
  expect(readConfig().gateways).toBeUndefined();
  expectMatchesFixture('base');
});
