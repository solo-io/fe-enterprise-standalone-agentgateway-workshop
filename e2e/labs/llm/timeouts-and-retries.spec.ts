// labs/llm/timeouts-and-retries.md
// @fixture base
// @profiles mock-llm-faults
// @docker yes
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { helperLogs, lab, labSh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'timeouts-and-retries');

test.describe.configure({ mode: 'serial' });

// The lab's request loop against the route on port 8080.
const LOOP = `for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code} ' http://localhost:8080/v1/chat/completions \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"mock-gpt","messages":[{"role":"user","content":"Hello"}]}'
done; echo`;

function loop(): string[] {
  const out = labSh(LOOP).stdout.trim();
  console.log(out);
  return out.split(/\s+/);
}

async function pasteInto(page: Page, editor: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(800);
  // Click outside the editor to close its suggestion list.
  await page.getByText('Policy YAML', { exact: true }).last().click();
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

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

/** Sends one message in the Chat Playground (already open) and waits for a reply or the failure banner. */
async function send(page: Page, prompt: string): Promise<'reply' | 'failed'> {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'mock-llm-slow' }).click();
  await main.getByPlaceholder('Ask a test question...').fill(prompt);
  await main.getByRole('button', { name: 'Send' }).click();
  const reply = main.locator('.chat-message.assistant .message-meta-chip').first();
  const banner = main.getByText('Playground request failed');
  await expect(reply.or(banner).first()).toBeVisible({ timeout: 30_000 });
  return (await banner.isVisible()) ? 'failed' : 'reply';
}

test('add the slow mock model', async ({ page }) => {
  await go(page, '/llm/models');
  const add = page.getByRole('button', { name: 'Add model', exact: true }).first();
  await shot(page, '01-models', add);
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill('mock-llm-slow');
  await d.getByPlaceholder('https://llm.internal.example.com').fill('http://mock-llm-slow:8000/v1');
  await d.getByRole('button', { name: 'Explicit', exact: true }).click();
  await d.getByRole('combobox', { name: 'Explicit outgoing model' })
    .or(d.getByRole('textbox', { name: 'Explicit outgoing model' })).first().fill('mock-gpt');
  await d.getByRole('heading', { name: 'Add model' }).click();
  await shot(page, '02-add-slow-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
  const m = readConfig().llm.models.find((x: any) => x.name === 'mock-llm-slow');
  expect(m.params).toEqual({ model: 'mock-gpt', baseUrl: 'http://mock-llm-slow:8000/v1' });
});

test('the slow model answers after about 5 seconds', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const t0 = Date.now();
  expect(await send(page, 'Hello')).toBe('reply');
  const secs = (Date.now() - t0) / 1000;
  console.log(`reply after ${secs}s`);
  expect(secs).toBeGreaterThan(4.5);
  await shot(page, '03-slow-reply', page.locator('.chat-message.assistant').last());
});

test('add a 2 second request timeout', async ({ page }) => {
  await go(page, '/llm/policies');
  const card = policyCard(page, 'Timeout');
  await shot(page, '04-timeout-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await pasteInto(page, d.locator('.monaco-editor').first(), 'requestTimeout: 2s');
  await shot(page, '05-timeout-yaml', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.timeout).toEqual({ requestTimeout: '2s' });
});

test('check it: the request times out after 2 seconds', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const t0 = Date.now();
  expect(await send(page, 'Hello')).toBe('failed');
  const secs = (Date.now() - t0) / 1000;
  console.log(`failed after ${secs}s`);
  expect(secs).toBeLessThan(4.5);
  const banner = page.locator('main').getByText('Playground request failed').locator('..');
  await expect(banner).toContainText('request timeout');
  await shot(page, '06-timeout', banner);

  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: 'mock-llm-slow' }).first();
  await expect(row).toContainText('504', { timeout: 30_000 });
  await shot(page, '07-logs-504', row);
});

test('add the public traffic gateway', async ({ page }) => {
  await go(page, '/');
  // With base, the Traffic section of the sidebar has only Get started.
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1);
  await start.click();
  const enable = page.locator('main').getByRole('button', { name: 'Enable' });
  await shot(page, '08-add-gateway', enable);
  await enable.click();
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  console.log(JSON.stringify(readConfig().gateways));
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
});

test('add a route to the flaky mock', async ({ page }) => {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Gateway' }).click();
  await page.getByRole('option', { name: /^public/ }).click();
  await d.getByRole('textbox', { name: /^Name/ }).fill('flaky-llm');
  await d.getByRole('button', { name: 'Add backend' }).click();
  await expect(d.getByRole('combobox', { name: 'Backend target type' })).toHaveText('Host');
  await d.getByRole('textbox', { name: 'Host', exact: true }).fill('mock-llm-flaky:8000');
  await shot(page, '09-add-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  const r = readConfig().routes;
  console.log(JSON.stringify(r));
  expect(r).toHaveLength(1);
  expect(r[0].name).toBe('flaky-llm');
  expect(r[0].backends).toEqual([{ host: 'mock-llm-flaky:8000' }]);
});

test('without retries, some requests fail', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const codes = loop();
  expect(codes).toHaveLength(20);
  expect(codes.filter((c) => c === '503').length).toBeGreaterThan(0);
  expect(codes.every((c) => c === '200' || c === '503')).toBeTruthy();
});

test('add a retry policy to the route', async ({ page }) => {
  await go(page, '/traffic/routes');
  const row = page.locator('main').getByRole('row', { name: /^flaky-llm\b/ });
  await row.getByRole('button', { name: 'Edit route' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Route policies/ }).click();
  const retry = d.getByRole('button', { name: /^(enabled|disabled)?\s*Retry\b/ }).first();
  await shot(page, '10-route-policies', retry);
  await retry.click();
  await pasteInto(page, d.locator('.monaco-editor:visible').first(), 'attempts: 5\nbackoff: 100ms\ncodes:\n- 503');
  const inner = d.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '11-retry-yaml', inner);
  await inner.click();
  // Saving returns to the Route policies list, which now shows Retry as configured. Close it to get back to the route.
  const list = page.getByRole('heading', { name: 'Route policies', exact: true }).locator('xpath=../..');
  await expect(list.getByRole('button', { name: /Retry/ }).first()).not.toContainText('disabled');
  await shot(page, '12-retry-configured', list.getByRole('button', { name: 'Close' }));
  await list.getByRole('button', { name: 'Close' }).click();
  await save(page, 'Save route');
  const p = readConfig().routes[0].policies.retry;
  console.log(JSON.stringify(p));
  expect(p).toEqual({ attempts: 5, backoff: '100ms', codes: [503] });
});

test('check it: with retries, the requests succeed', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const codes = loop();
  expect(codes.filter((c) => c === '200').length).toBeGreaterThanOrEqual(19);
  const logs = helperLogs('agentgateway');
  expect(logs).toMatch(/route=default\/flaky-llm .*retry\.attempt=\d/);
  console.log(logs.split('\n').filter((l) => l.includes('retry.attempt')).slice(-2).join('\n'));
});

test('clean up', async ({ page }) => {
  await go(page, '/traffic/routes');
  const row = page.locator('main').getByRole('row', { name: /^flaky-llm\b/ });
  // Delete route acts at once, without a confirmation.
  await row.getByRole('button', { name: 'Delete route' }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);

  await go(page, '/traffic/gateways');
  const gw = page.locator('main').getByRole('heading', { name: 'public' });
  await gw.locator('xpath=../..').getByRole('button', { name: 'Delete gateway' }).click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Delete/ });
  if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) { console.log('gateway delete asks to confirm'); await confirm.click(); }
  await expect(gw).toHaveCount(0);
  await page.waitForTimeout(1000);

  await go(page, '/llm/policies');
  await policyCard(page, 'Timeout').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.waitForTimeout(1500);

  await go(page, '/llm/models');
  const m = page.locator('main').getByRole('row').filter({ has: page.getByText('mock-llm-slow', { exact: true }) });
  await m.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete model$/ }).click();
  await expect(m).toHaveCount(0);
  await page.waitForTimeout(1000);

  // Deleting the last gateway leaves `gateways: {}` and `routes: []`; remove both lines.
  await go(page, '/raw-config');
  const gwLine = rawLine(page, /^gateways:\s\{\}/);
  await expect(gwLine).toBeVisible();
  await expect(rawLine(page, /^routes:\s\[\]/)).toBeVisible();
  await gwLine.click({ position: { x: 1, y: 5 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Delete');
  await expect(rawLine(page, /^gateways:/)).toHaveCount(0);
  await expect(rawLine(page, /^routes:/)).toHaveCount(0);
  await saveRaw(page);
  const cfg = readConfig();
  console.log(JSON.stringify({ gateways: cfg.gateways, routes: cfg.routes, timeout: cfg.llm.policies.timeout }));
  expect(cfg.gateways).toBeUndefined();
  expect(cfg.routes).toBeUndefined();
});
