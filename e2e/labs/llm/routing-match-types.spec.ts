// labs/llm/routing-match-types.md
// @fixture base
// @profiles mock-llm-routing
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { lab, labSh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'routing-match-types');

test.describe.configure({ mode: 'serial' });

// The block the reader pastes at the top of Raw Configuration, as written in the lab.
const BACKENDS = `backends:
  - name: mini
    ai:
      name: mini
      provider:
        openAI:
          model: mock-mini
      hostOverride: mock-llm-mini:8000
  - name: nano
    ai:
      name: nano
      provider:
        openAI:
          model: mock-nano
      hostOverride: mock-llm-nano:8000
`;

/** Runs a lab curl and returns the model the reply came from, as the lab's grep prints it. */
function model(path: string, extra = ''): string {
  const cmd = `curl -s 'http://localhost:8080${path}' ${extra}-H 'Content-Type: application/json' \\
  -d '{"messages":[{"role":"user","content":"Hello"}]}' | grep -o '"model":"[^"]*"'`;
  const out = labSh(cmd).stdout.trim();
  console.log(`${path} ${extra}=> ${out}`);
  return out;
}

async function pasteInto(page: Page, editor: Locator, text: string, label = 'Policy YAML') {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(800);
  await page.getByText(label, { exact: true }).last().click();
}

/** Opens Add route, picks the public gateway and names the route. Returns the panel. */
async function newRoute(page: Page, name: string): Promise<Locator> {
  await go(page, '/traffic/routes');
  await page.locator('main').getByRole('button', { name: 'Add route' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Gateway' }).click();
  await page.getByRole('option', { name: /^public/ }).click();
  await d.getByRole('textbox', { name: /^Name/ }).fill(name);
  return d;
}

/** Adds a Backend reference backend to the open route panel. */
async function addBackend(page: Page, d: Locator, backend: string) {
  await d.getByRole('button', { name: 'Add backend' }).click();
  await d.getByRole('combobox', { name: 'Backend target type' }).click();
  await page.getByRole('option', { name: 'Backend reference', exact: true }).click();
  await d.getByRole('textbox', { name: 'Backend reference' }).fill(backend);
}

function route(name: string): any {
  return readConfig().routes.find((r: any) => r.name === name);
}

test('add the two model backends in Raw Configuration', async ({ page }) => {
  await go(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.evaluate((t) => navigator.clipboard.writeText(t), BACKENDS);
  await page.keyboard.press('ControlOrMeta+V');
  await page.waitForTimeout(800);
  await page.keyboard.press('ControlOrMeta+Home');
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '01-raw-config-backends', saveBtn);
  await saveBtn.click();
  await expect.poll(() => readConfig().backends?.map((b: any) => b.name)).toEqual(['mini', 'nano']);
  console.log(readFileSync('/work/config.yaml', 'utf8').slice(0, 600));
  const b = readConfig().backends;
  expect(b[1]).toEqual({ name: 'nano', ai: { name: 'nano', provider: { openAI: { model: 'mock-nano' } }, hostOverride: 'mock-llm-nano:8000' } });
});

test('add the public gateway on port 8080', async ({ page }) => {
  await go(page, '/');
  // With base, the Traffic section of the sidebar has only Get started.
  const start = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).nth(1);
  await start.click();
  const enable = page.locator('main').getByRole('button', { name: 'Enable' });
  await shot(page, '02-add-gateway', enable);
  await enable.click();
  await expect(page.locator('main').getByRole('heading', { name: 'public' })).toBeVisible();
  expect(readConfig().gateways).toEqual({ public: { port: 8080 } });
});

test('add the default route to mini', async ({ page }) => {
  const d = await newRoute(page, 'default');
  await addBackend(page, d, 'mini');
  await shot(page, '03-default-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  const r = route('default');
  console.log(JSON.stringify(r));
  expect(r.matches).toEqual([{ path: { pathPrefix: '/' } }]);
  expect(r.backends).toEqual([{ backend: 'mini' }]);
});

test('check: every request goes to mini', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  expect(model('/v1/chat/completions')).toBe('"model":"mock-mini"');
});

test('add a path route to nano', async ({ page }) => {
  const d = await newRoute(page, 'nano-path');
  const path = d.getByRole('textbox', { name: 'Path', exact: true }).or(d.getByPlaceholder('/', { exact: true })).first();
  await path.fill('/nano');
  await expect(d.getByRole('combobox', { name: 'Path match' })).toHaveText('Prefix');
  await d.getByRole('heading', { name: 'Add route' }).scrollIntoViewIfNeeded();
  await shot(page, '04-path-route', path);
  await addBackend(page, d, 'nano');
  await shot(page, '05-route-policies', d.getByRole('button', { name: /^Route policies/ }));
  await d.getByRole('button', { name: /^Route policies/ }).click();
  const rw = d.getByRole('button', { name: /^(enabled|disabled)?\s*URL rewrite\b/ }).first();
  await shot(page, '06-url-rewrite-card', rw);
  await rw.click();
  await pasteInto(page, d.locator('.monaco-editor:visible').first(), 'path:\n  prefix: /');
  const inner = d.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '07-url-rewrite-yaml', inner);
  await inner.click();
  const list = page.getByRole('heading', { name: 'Route policies', exact: true }).locator('xpath=../..');
  await expect(list.getByRole('button', { name: /URL rewrite/ }).first()).not.toContainText('disabled');
  await list.getByRole('button', { name: 'Close' }).click();
  await save(page, 'Save route');
  const r = route('nano-path');
  console.log(JSON.stringify(r));
  expect(r.matches).toEqual([{ path: { pathPrefix: '/nano' } }]);
  expect(r.backends).toEqual([{ backend: 'nano' }]);
  expect(r.policies.urlRewrite).toEqual({ path: { prefix: '/' } });
});

test('check: /nano goes to nano, other paths to mini', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  expect(model('/nano/v1/chat/completions')).toBe('"model":"mock-nano"');
  expect(model('/v1/chat/completions')).toBe('"model":"mock-mini"');
});

test('add a header route to nano', async ({ page }) => {
  const d = await newRoute(page, 'nano-header');
  await d.getByRole('button', { name: 'Add header' }).click();
  await d.getByRole('textbox', { name: 'Header name' }).fill('x-model');
  await d.getByRole('textbox', { name: 'Header value' }).fill('nano');
  await addBackend(page, d, 'nano');
  await d.getByRole('textbox', { name: 'Header name' }).scrollIntoViewIfNeeded();
  await shot(page, '08-header-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  const r = route('nano-header');
  console.log(JSON.stringify(r));
  expect(r.matches[0].headers).toEqual([{ name: 'x-model', value: { exact: 'nano' } }]);
  expect(r.backends).toEqual([{ backend: 'nano' }]);
});

test('check: the header sends the request to nano', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  expect(model('/v1/chat/completions', "-H 'x-model: nano' ")).toBe('"model":"mock-nano"');
  expect(model('/v1/chat/completions')).toBe('"model":"mock-mini"');
});

test('add a query route to nano', async ({ page }) => {
  const d = await newRoute(page, 'nano-query');
  await d.getByRole('button', { name: 'Add query' }).click();
  await d.getByRole('textbox', { name: 'Query name' }).fill('model');
  await d.getByRole('textbox', { name: 'Query value' }).fill('nano');
  await addBackend(page, d, 'nano');
  await d.getByRole('textbox', { name: 'Query name' }).scrollIntoViewIfNeeded();
  await shot(page, '09-query-route', d.getByRole('button', { name: 'Save route' }));
  await save(page, 'Save route');
  const r = route('nano-query');
  console.log(JSON.stringify(r));
  expect(r.matches[0].query).toEqual([{ name: 'model', value: { exact: 'nano' } }]);
});

test('check it: each match sends the request to nano', async ({ page }) => {
  await new Promise((r) => setTimeout(r, 2000));
  const out = labSh(`for q in '?model=nano' '?model=mini' ''; do
  curl -s "http://localhost:8080/v1/chat/completions$q" -H 'Content-Type: application/json' \\
    -d '{"messages":[{"role":"user","content":"Hello"}]}' | grep -o '"model":"[^"]*"'
done`).stdout.trim();
  console.log(out);
  expect(out.split('\n')).toEqual(['"model":"mock-nano"', '"model":"mock-mini"', '"model":"mock-mini"']);
  await go(page, '/traffic/routes');
  await expect(page.locator('main').getByRole('row', { name: /^nano-query\b/ })).toBeVisible();
  await shot(page, '10-routes');
  // The routes go to ai backends, so the requests also appear on the Logs page.
  await go(page, '/llm/logs');
  await expect(page.locator('main tbody tr').filter({ hasText: 'mock-nano' }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main tbody tr').filter({ hasText: 'mock-mini' }).first()).toBeVisible();
  console.log(JSON.stringify(readConfig().routes.map((r: any) => r.name)));
});

test('clean up', async ({ page }) => {
  await go(page, '/traffic/routes');
  for (const name of ['nano-query', 'nano-header', 'nano-path', 'default']) {
    const row = page.locator('main').getByRole('row', { name: new RegExp(`^${name}\\b`) });
    await row.getByRole('button', { name: 'Delete route' }).click();
    await expect(row).toHaveCount(0);
    await page.waitForTimeout(1000);
  }

  await go(page, '/traffic/gateways');
  const gw = page.locator('main').getByRole('heading', { name: 'public' });
  await gw.locator('xpath=../..').getByRole('button', { name: 'Delete gateway' }).click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: /^Delete/ });
  if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) { console.log('gateway delete asks to confirm'); await confirm.click(); }
  await expect(gw).toHaveCount(0);
  await page.waitForTimeout(1000);

  // The UI now keeps the backends block near the end of the file.
  await go(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  const line = (re: RegExp) => editor.locator('.view-line', { hasText: re }).first();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+End');
  await line(/^backends:/).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  for (let i = 0; i < 15; i++) await page.keyboard.press('Shift+ArrowDown');
  await shot(page, '11-raw-config-delete', page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  await page.keyboard.press('Delete');
  // Deleting the last gateway leaves `gateways: {}` and `routes: []`; remove both lines.
  for (const re of [/^gateways:\s\{\}/, /^routes:\s\[\]/]) {
    await expect(line(re)).toBeVisible();
    await line(re).click({ position: { x: 1, y: 5 } });
    await page.keyboard.press('Home');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Delete');
  }
  await save(page, page.locator('main').getByRole('button', { name: 'Save', exact: true }));
  const confirmSave = page.getByRole('dialog').getByRole('button', { name: /Save/ });
  if (await confirmSave.isVisible().catch(() => false)) await save(page, confirmSave);
  const cfg = readConfig();
  console.log(JSON.stringify({ backends: cfg.backends, gateways: cfg.gateways, routes: cfg.routes }));
  expect(cfg.backends ?? []).toEqual([]);
  expect(cfg.gateways).toBeUndefined();
  expect(cfg.routes).toBeUndefined();
});
