// labs/platform/tls-termination.md
// @fixture base
// @profiles mock-llm
import { expect, test, type Page } from '@playwright/test';
import { expectMatchesFixture, readConfig } from '../../lib/config';
import { lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('platform', 'tls-termination');

test.describe.configure({ mode: 'serial' });

// The lab's commands, as written. The reader runs them from the setup/ folder.
const BODY = `-H 'Content-Type: application/json' \\
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"Hello"}]}'`;
const HTTPS_TRUSTED = `curl -sS -o /dev/null -w '%{http_code}\\n' --cacert tls/ca.crt \\
  https://localhost:8443/v1/chat/completions ${BODY}`;
const HTTPS_UNTRUSTED = `curl -sS -o /dev/null -w '%{http_code}\\n' \\
  https://localhost:8443/v1/chat/completions ${BODY}`;
const PLAIN_HTTP = `curl -sS -o /dev/null -w '%{http_code}\\n' \\
  http://localhost:8443/v1/chat/completions ${BODY}`;
const WITH_CLIENT_CERT = `curl -sS -o /dev/null -w '%{http_code}\\n' --cacert tls/ca.crt \\
  --cert tls/client.crt --key tls/client.key \\
  https://localhost:8443/v1/chat/completions ${BODY}`;
const ROOT_LINE = 'root: /config/tls/ca.crt';

function run(cmd: string): { code: number; out: string } {
  const r = sh(`cd /repo/setup && ${cmd}`);
  console.log(`$ ${cmd}\nexit ${r.code}\n${r.stdout}`);
  return { code: r.code, out: r.stdout.trim() };
}

/** The first Raw Configuration editor line that contains `text`. */
function rawLine(page: Page, text: string | RegExp) {
  return page.locator('main .monaco-editor .view-line').filter({ hasText: text }).first();
}

async function saveRaw(page: Page) {
  await save(page, page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.isVisible().catch(() => false)) await save(page, confirm);
}

test('enable Traffic', async ({ page }) => {
  await go(page, '/');
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1);
  await shot(page, '01-traffic-get-started', start);
  await start.click();
  await page.locator('main').getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
  await shot(page, '02-public-gateway', page.locator('main').getByRole('button', { name: 'Edit gateway' }));
});

test('turn the gateway into an HTTPS gateway on port 8443', async ({ page }) => {
  await go(page, '/traffic/gateways');
  await page.locator('main').getByRole('button', { name: 'Edit gateway' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /^Name/ }).fill('https');
  await d.getByRole('textbox', { name: /^Port/ }).fill('8443');
  await d.getByRole('combobox', { name: 'Protocol' }).click();
  await page.getByRole('option', { name: 'HTTPS', exact: true }).click();
  await d.locator('summary', { hasText: /^TLS$/ }).click();
  await d.getByPlaceholder('/etc/certs/tls.crt').fill('/config/tls/localhost.crt');
  await d.getByPlaceholder('/etc/certs/tls.key').fill('/config/tls/localhost.key');
  await shot(page, '03-edit-gateway', d.getByRole('button', { name: 'Save gateway' }));
  await save(page, 'Save gateway');
  expect(readConfig().gateways).toEqual({
    https: { port: 8443, tls: { cert: '/config/tls/localhost.crt', key: '/config/tls/localhost.key' } },
  });
  await expect(page.locator('main').getByRole('heading', { name: 'https' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Port 8443');
  await shot(page, '04-https-gateway', page.locator('main').getByRole('heading', { name: 'https' }).locator('xpath=../..'));
});

test('route the HTTPS gateway to the mock LLM', async ({ page }) => {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Gateway' }).click();
  await page.getByRole('option', { name: /^https/ }).click();
  await d.getByRole('textbox', { name: /^Name/ }).fill('mock-llm');
  await d.getByRole('button', { name: 'Add backend' }).click();
  await expect(d.getByRole('combobox', { name: 'Backend target type' })).toHaveText('Host');
  await d.getByRole('textbox', { name: 'Host', exact: true }).fill('mock-llm:8000');
  await shot(page, '05-add-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  expect(readConfig().routes).toEqual([
    { gateways: 'https', matches: [{ path: { pathPrefix: '/' } }], backends: [{ host: 'mock-llm:8000' }], name: 'mock-llm' },
  ]);
});

test('check it: HTTPS works with the workshop CA, and fails without it or over plain HTTP', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  let r = run(HTTPS_TRUSTED);
  expect(r.code).toBe(0);
  expect(r.out).toBe('200');
  r = run(HTTPS_UNTRUSTED);
  expect(r.code).toBe(60); // server certificate not trusted
  expect(r.out).toMatch(/^000$/m);
  r = run(PLAIN_HTTP);
  expect(r.code).not.toBe(0);
  expect(r.out).toMatch(/^000$/m);
});

test('require client certificates in Raw Configuration', async ({ page }) => {
  await go(page, '/raw-config');
  const key = rawLine(page, 'key: /config/tls/localhost.key');
  await expect(key).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), ROOT_LINE);
  // The lab: click at the end of the key line, press End and Enter, paste.
  await key.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(rawLine(page, ROOT_LINE)).toBeVisible();
  await shot(page, '06-raw-config', page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  await saveRaw(page);
  expect(readConfig().gateways.https.tls).toEqual({
    cert: '/config/tls/localhost.crt', key: '/config/tls/localhost.key', root: '/config/tls/ca.crt',
  });
});

test('check it: a request needs the client certificate', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  let r = run(HTTPS_TRUSTED);
  expect(r.code).not.toBe(0); // TLS error: the gateway asks for a client certificate
  expect([35, 56]).toContain(r.code);
  expect(r.out).toMatch(/^000$/m);
  r = run(WITH_CLIENT_CERT);
  expect(r.code).toBe(0);
  expect(r.out).toBe('200');
});

test('clean up', async ({ page }) => {
  const main = page.locator('main');
  await go(page, '/traffic/routes');
  const row = main.getByRole('row', { name: /^mock-llm\b/ });
  await row.getByRole('button', { name: 'Delete route' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);

  await go(page, '/traffic/gateways');
  await save(page, main.getByRole('button', { name: 'Delete gateway' }));
  await expect(main).toContainText('No gateways configured');

  await go(page, '/raw-config');
  const gw = rawLine(page, /^gateways:\s\{\}/);
  await expect(gw).toBeVisible();
  // Monaco can replace its line elements right after the page loads; retry the screenshot if it does.
  await expect(async () => shot(page, '07-empty-gateways', gw)).toPass({ timeout: 15_000 });
  await gw.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  // Select the `gateways: {}` and `routes: []` lines and delete them.
  await expect(rawLine(page, /^routes:\s\[\]/)).toBeVisible();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(rawLine(page, /^gateways:/)).toHaveCount(0);
  await expect(rawLine(page, /^routes:/)).toHaveCount(0);
  await saveRaw(page);
  const cfg = readConfig();
  console.log(JSON.stringify({ gateways: cfg.gateways, routes: cfg.routes }));
  expect(cfg.gateways).toBeUndefined();
  expect(cfg.routes).toBeUndefined();
  expectMatchesFixture('base');
});
