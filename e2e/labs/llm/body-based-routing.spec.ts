// labs/llm/body-based-routing.md
// @fixture llm-ready
// @profiles mock-llm-routing
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'body-based-routing');

test.describe.configure({ mode: 'serial' });

const CONDITION = 'json(request.body).metadata.app == "support"';

/** The lab's curl. `metadata` is the extra JSON the lab adds to the body, or ''. Returns what grep prints. */
function curlModel(metadata: string): string {
  const cmd = `curl -s http://localhost:4000/v1/chat/completions -H 'Content-Type: application/json' \\
  -d '{"model":"router",${metadata}"messages":[{"role":"user","content":"Hello"}]}' | grep -o '"model":"[^"]*"'`;
  const out = sh(cmd).stdout.trim();
  console.log(`${metadata || '(no metadata)'} => ${out}`);
  return out;
}

/** Opens Add model and fills a Custom provider model for one of the routing mocks. */
async function addMockModel(page: Page, name: string): Promise<Locator> {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill(name);
  await d.getByPlaceholder('https://llm.internal.example.com').fill(`http://${name.replace('mock-', 'mock-llm-')}:8000/v1`);
  await d.getByRole('button', { name: 'Explicit', exact: true }).click();
  await d.getByRole('combobox', { name: 'Explicit outgoing model' })
    .or(d.getByRole('textbox', { name: 'Explicit outgoing model' })).first().fill(name);
  // Close the model suggestions list (Escape would close the whole panel).
  await d.getByRole('heading', { name: 'Add model' }).click();
  return d;
}

test('add the two mock models', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '01-models', page.getByRole('button', { name: 'Add model', exact: true }).first());
  for (const [name, n] of [['mock-mini', '02'], ['mock-nano', '']] as const) {
    const d = await addMockModel(page, name);
    if (n) {
      await d.getByRole('textbox', { name: /Incoming model match/ }).scrollIntoViewIfNeeded();
      await shot(page, `${n}-add-mock-mini`, d.getByRole('button', { name: 'Save model' }));
    }
    await save(page, 'Save model');
    const m = readConfig().llm.models.find((x: any) => x.name === name);
    expect(m.params).toEqual({ model: name, baseUrl: `http://${name.replace('mock-', 'mock-llm-')}:8000/v1` });
  }
  await expect(page.locator('main').getByRole('row', { name: /mock-nano/ })).toBeVisible();
  await shot(page, '03-models-mocks', page.getByRole('button', { name: 'Add virtual model', exact: true }));
});

test('add the conditional virtual model', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add virtual model', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('resilient').fill('router');
  await d.getByRole('button', { name: 'Conditional', exact: true }).click();
  // Rule 1 and Fallback each have a Condition box and a Target model.
  // Condition is a code editor that starts with an example, json(request.body).route == "default".
  // Replace it in Rule 1; the Fallback condition stays empty.
  const rule1 = d.locator('.monaco-editor:visible').first();
  await expect(rule1).toContainText('json(request.body).route == "default"');
  await rule1.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(CONDITION, { delay: 20 });
  // The editor reports its value after a short debounce.
  await page.waitForTimeout(800);
  const targets = d.getByRole('combobox', { name: 'Target model' });
  await targets.nth(0).click();
  await page.getByRole('option', { name: 'mock-nano', exact: true }).click();
  await targets.nth(1).click();
  await page.getByRole('option', { name: 'mock-mini', exact: true }).click();
  await d.getByText('Rule 1', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '04-rule-1', rule1);
  await targets.nth(1).scrollIntoViewIfNeeded();
  await shot(page, '05-fallback', d.getByRole('button', { name: 'Save virtual model' }));
  await save(page, 'Save virtual model');
  const vm = readConfig().llm.virtualModels;
  console.log(JSON.stringify(vm));
  expect(vm).toEqual([
    { name: 'router', routing: { conditional: { targets: [{ when: CONDITION, model: 'mock-nano' }, { model: 'mock-mini' }] } } },
  ]);
});

test('the playground request goes to the fallback model', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const text = await chat(page, { model: 'router', prompt: 'Hello' });
  console.log(text);
  const reply = page.locator('.chat-message.assistant').last();
  await expect(reply.locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  await shot(page, '06-playground', reply);
});

test('check it: curl with and without the support tag', async ({ page }) => {
  expect(curlModel('"metadata":{"app":"support"},')).toBe('"model":"mock-nano"');
  expect(curlModel('')).toBe('"model":"mock-mini"');
  await go(page, '/llm/logs');
  const rows = page.locator('main tbody tr').filter({ hasText: 'router' });
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  // Newest first: the curl without metadata, the curl with it, then the playground request.
  await expect(rows.nth(0)).toContainText('mock-mini');
  await expect(rows.nth(1)).toContainText('mock-nano');
  await expect(rows.nth(2)).toContainText('mock-mini');
  await shot(page, '07-logs');
});

test('clean up: delete the virtual model and both mock models', async ({ page }) => {
  await go(page, '/llm/models');
  const main = page.locator('main');
  for (const name of ['router', 'mock-mini', 'mock-nano']) {
    const row = main.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
    await row.getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: /^Delete (virtual )?model$/ }).click();
    await expect(row).toHaveCount(0);
    await page.waitForTimeout(1000);
  }
  const cfg = readConfig();
  expect(cfg.llm.virtualModels ?? []).toEqual([]);
  expect(cfg.llm.models.map((m: any) => m.name)).toEqual(['openai/*']);
});
