// labs/platform/sni-matching.md
// @fixture base
// @profiles mock-llm
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectMatchesFixture, readConfig } from '../../lib/config';
import { lab, labSh, sh } from '../../lib/lab';

const { go, shot, save } = lab('platform', 'sni-matching');

test.describe.configure({ mode: 'serial' });

// The lab's commands. The reader runs them from the setup/ folder.
const call = (host: string) => `curl -sS -o /dev/null -w '%{http_code}\\n' --cacert tls/ca.crt \\
  --resolve ${host}:8443:127.0.0.1 https://${host}:8443/v1/chat/completions \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"Hello"}]}'`;
const SUBJECT_FOO = `curl -sv -o /dev/null --cacert tls/ca.crt \\
  --resolve foo.example.com:8443:127.0.0.1 https://foo.example.com:8443/v1/models 2>&1 | grep 'subject:'`;

/** Runs `cmd` from setup/. `inLab` false is for a variant the lab only describes in words. */
function run(cmd: string, inLab = true): { code: number; out: string } {
  const r = inLab ? labSh(cmd) : sh(cmd, '/repo/setup');
  console.log(`$ ${cmd}\nexit ${r.code}\n${r.stdout}`);
  return { code: r.code, out: r.stdout.trim() };
}

function rawLine(page: Page, text: string | RegExp) {
  return page.locator('main .monaco-editor .view-line').filter({ hasText: text }).first();
}

/** Fills the listener panel (already open): name, HTTPS, hostname, certificate and key. */
async function fillListener(page: Page, d: Locator, name: string) {
  await d.getByRole('textbox', { name: /^Name/ }).fill(name);
  await d.getByRole('combobox', { name: 'Protocol' }).click();
  await page.getByRole('option', { name: 'HTTPS', exact: true }).click();
  await d.getByRole('textbox', { name: /^Hostname/ }).fill(`${name}.example.com`);
  const tls = d.locator('summary', { hasText: /^TLS$/ });
  // The TLS section starts closed; the lab tells the reader to click it.
  expect(await tls.locator('..').getAttribute('open')).toBeNull();
  await tls.click();
  await d.getByPlaceholder('/etc/certs/tls.crt').fill(`/config/tls/${name}.example.com.crt`);
  await d.getByPlaceholder('/etc/certs/tls.key').fill(`/config/tls/${name}.example.com.key`);
}

const listener = (name: string) => ({
  name,
  hostname: `${name}.example.com`,
  tls: { cert: `/config/tls/${name}.example.com.crt`, key: `/config/tls/${name}.example.com.key` },
});

test('enable Traffic', async ({ page }) => {
  await go(page, '/');
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1);
  await shot(page, '01-traffic-get-started', start);
  await start.click();
  await page.locator('main').getByRole('button', { name: 'Enable' }).click();
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
});

test('turn the gateway into a gateway with listeners on port 8443', async ({ page }) => {
  await go(page, '/traffic/gateways');
  await page.locator('main').getByRole('button', { name: 'Edit gateway' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /^Name/ }).fill('sni');
  await d.getByRole('textbox', { name: /^Port/ }).fill('8443');
  await d.getByText('Multiple listeners').click();
  await expect(d.getByRole('checkbox', { name: /Multiple listeners/ })).toBeChecked();
  await shot(page, '02-edit-gateway', d.getByRole('button', { name: 'Save gateway' }));
  await save(page, 'Save gateway');
  expect(readConfig().gateways).toEqual({ sni: { port: 8443, listeners: [{ name: 'listener1' }] } });
});

test('make the first listener serve foo.example.com', async ({ page }) => {
  await go(page, '/traffic/gateways');
  const edit = page.locator('main').getByRole('button', { name: 'Edit listener' });
  await shot(page, '03-edit-listener', edit);
  await edit.click();
  const d = page.getByRole('dialog');
  await fillListener(page, d, 'foo');
  await shot(page, '04-foo-listener', d.getByRole('button', { name: 'Save listener' }));
  await save(page, 'Save listener');
  expect(readConfig().gateways.sni.listeners).toEqual([listener('foo')]);
});

test('add a listener for bar.example.com', async ({ page }) => {
  await go(page, '/traffic/gateways');
  const add = page.locator('main').getByRole('button', { name: 'Add listener' });
  await shot(page, '05-add-listener', add);
  await add.click();
  const d = page.getByRole('dialog');
  await fillListener(page, d, 'bar');
  await shot(page, '06-bar-listener', d.getByRole('button', { name: 'Save listener' }));
  await save(page, 'Save listener');
  expect(readConfig().gateways.sni.listeners).toEqual([listener('foo'), listener('bar')]);
  await go(page, '/traffic/gateways');
  await expect(page.locator('main')).toContainText('bar.example.com');
  await shot(page, '07-listeners', page.locator('main').getByRole('heading', { name: 'sni' }).locator('xpath=../../..'));
});

test('route the gateway to the mock LLM', async ({ page }) => {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Gateway' }).click();
  await page.getByRole('option', { name: /^sni \(all HTTP listeners\)/ }).click();
  await d.getByRole('textbox', { name: /^Name/ }).fill('mock-llm');
  await d.getByRole('button', { name: 'Add backend' }).click();
  await expect(d.getByRole('combobox', { name: 'Backend target type' })).toHaveText('Host');
  await d.getByRole('textbox', { name: 'Host', exact: true }).fill('mock-llm:8000');
  await shot(page, '08-add-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  expect(readConfig().routes).toEqual([
    { gateways: 'sni', matches: [{ path: { pathPrefix: '/' } }], backends: [{ host: 'mock-llm:8000' }], name: 'mock-llm' },
  ]);
});

test('check it: each hostname gets its own certificate, and an unknown hostname fails', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  for (const host of ['foo.example.com', 'bar.example.com']) {
    const r = run(call(host));
    expect(r.code).toBe(0); // curl verified a certificate for this exact hostname
    expect(r.out).toBe('200');
  }
  // The optional block: the certificate subject. The lab shows the foo command and tells the reader to change foo to bar.
  let v = run(SUBJECT_FOO);
  expect(v.out).toBe('*  subject: O=agentgateway workshop; CN=foo.example.com');
  v = run(SUBJECT_FOO.replaceAll('foo', 'bar'), false);
  expect(v.out).toBe('*  subject: O=agentgateway workshop; CN=bar.example.com');
  const r = run(call('baz.example.com'));
  expect(r.code).toBe(35); // TLS handshake failed: no listener for this hostname
  expect(r.out).toMatch(/^000$/m);
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
  await expect(rawLine(page, /^routes:\s\[\]/)).toBeVisible();
  await gw.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(rawLine(page, /^gateways:/)).toHaveCount(0);
  await expect(rawLine(page, /^routes:/)).toHaveCount(0);
  await save(page, main.getByRole('button', { name: 'Save', exact: true }));
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirm.isVisible().catch(() => false)) await save(page, confirm);
  const cfg = readConfig();
  expect(cfg.gateways).toBeUndefined();
  expect(cfg.routes).toBeUndefined();
  expectMatchesFixture('base');
});
