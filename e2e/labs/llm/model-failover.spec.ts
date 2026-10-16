// labs/llm/model-failover.md
// @fixture llm-ready
// @profiles mock-llm
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chatRequest, lab } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'model-failover');

test.describe.configure({ mode: 'serial' });

/** Opens Add model and fills a Custom provider model that sends `mock-gpt` to a mock on port 8000. */
async function addMockModel(page: Page, name: string): Promise<Locator> {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill(name);
  await d.getByPlaceholder('https://llm.internal.example.com').fill(`http://${name}:8000/v1`);
  await d.getByRole('button', { name: 'Explicit', exact: true }).click();
  await d.getByRole('combobox', { name: 'Explicit outgoing model' })
    .or(d.getByRole('textbox', { name: 'Explicit outgoing model' })).first().fill('mock-gpt');
  // Close the model suggestions list (Escape would close the whole panel).
  await d.getByRole('heading', { name: 'Add model' }).click();
  return d;
}

test('add the rate-limited mock model with a health policy', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '01-models', page.getByRole('button', { name: 'Add model', exact: true }).first());
  const d = await addMockModel(page, 'mock-llm-429');
  await d.getByRole('textbox', { name: /Incoming model match/ }).scrollIntoViewIfNeeded();
  await shot(page, '02-add-mock-llm-429', d.getByPlaceholder('https://llm.internal.example.com'));

  await d.getByRole('button', { name: /^Advanced/ }).click();
  await d.getByRole('button', { name: /^Model policies/ }).click();
  await d.getByRole('button', { name: /^Health/ }).click();
  // Unhealthy expression is a code editor, not a plain textarea.
  await d.locator('.monaco-editor:visible').first().click();
  await page.keyboard.type('response.code == 429', { delay: 20 });
  // The editor reports its value after a short debounce.
  await page.waitForTimeout(800);
  await d.getByLabel('Eviction duration').fill('60s');
  await d.getByLabel('Consecutive failures').fill('1');
  await d.getByLabel('Consecutive failures').scrollIntoViewIfNeeded();
  await shot(page, '03-health-policy', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  const m = readConfig().llm.models.find((x: any) => x.name === 'mock-llm-429');
  expect(m.params).toEqual({ model: 'mock-gpt', baseUrl: 'http://mock-llm-429:8000/v1' });
  expect(m.health).toEqual({ unhealthyExpression: 'response.code == 429', eviction: { duration: '60s', consecutiveFailures: 1 } });
});

test('add the healthy mock model', async ({ page }) => {
  const d = await addMockModel(page, 'mock-llm');
  await d.getByRole('textbox', { name: /Incoming model match/ }).scrollIntoViewIfNeeded();
  await shot(page, '04-add-mock-llm', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  const main = page.locator('main');
  await expect(main.getByRole('row', { name: /mock-llm-429/ })).toBeVisible();
  await expect(main.getByRole('row', { name: /^mock-llm\b(?!-)/ })).toBeVisible();
  await shot(page, '05-models-mocks', page.getByRole('button', { name: 'Add virtual model', exact: true }));
});

test('add the failover virtual model', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add virtual model', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('resilient').fill('mock-failover');
  await d.getByRole('button', { name: 'Failover', exact: true }).click();
  await d.getByRole('combobox', { name: 'Model' }).first().click();
  await page.getByRole('option', { name: 'mock-llm-429', exact: true }).click();
  await d.getByRole('button', { name: 'Add fallback group' }).click();
  await d.getByRole('combobox', { name: 'Model' }).nth(1).click();
  await page.getByRole('option', { name: 'mock-llm', exact: true }).click();
  await expect(d).toContainText('Fallback group 2');
  await shot(page, '06-add-virtual-model', d.getByRole('button', { name: 'Save virtual model' }));
  await save(page, 'Save virtual model');

  expect(readConfig().llm.virtualModels).toEqual([
    { name: 'mock-failover', routing: { failover: { targets: [{ model: 'mock-llm-429', priority: 0 }, { model: 'mock-llm', priority: 1 }] } } },
  ]);
});

test('the playground fails over to the healthy mock', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  // First request: mock-llm-429 answers 429, and the health policy evicts it.
  // The playground shows a failed request as a banner, not as a chat message.
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'mock-failover' }).click();
  await main.getByPlaceholder('Ask a test question...').fill('Hello');
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('"code":429');
  await expect(main.locator('.chat-message.assistant')).toHaveCount(0);
  await shot(page, '07-playground-429', main.getByRole('button', { name: 'Send' }));
  // Second request: only the fallback group is left, so mock-llm answers.
  // The failed message stays in User message; the reader clicks Send again.
  await expect(main.getByPlaceholder('Ask a test question...')).toHaveValue('Hello');
  await main.getByRole('button', { name: 'Send' }).click();
  const reply = main.locator('.chat-message.assistant').first();
  await expect(reply.locator('.message-meta-chip').first()).toBeVisible({ timeout: 60_000 });
  const second = await reply.innerText();
  await expect(reply.locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  expect(second).not.toContain('429');
  await shot(page, '08-playground-ok', page.locator('.chat-message.assistant').last());
});

test('Logs show the 429 and the 200', async ({ page }) => {
  await go(page, '/llm/logs');
  // Only the two playground requests, newest first: the 200 from mock-llm, then the 429.
  // The browser's preflight shows as a separate "unknown model" row, which the lab says to ignore.
  const rows = page.locator('main tbody tr').filter({ hasText: 'mock-failover' });
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(rows.nth(0)).toContainText('200');
  await expect(rows.nth(1)).toContainText('429');
  await shot(page, '09-logs');

  // The optional curl, after the screenshot so its row does not show in it.
  // mock-llm-429 can only answer 429, so a 200 proves the healthy mock served it.
  const r = await chatRequest('mock-failover', 'Hello from curl');
  expect(r.status).toBe(200);
  expect(JSON.parse(r.text).model).toBe('mock-gpt');
});

test('clean up: delete the virtual model and both mock models', async ({ page }) => {
  await go(page, '/llm/models');
  const main = page.locator('main');
  for (const [name, n] of [['mock-failover', '10'], ['mock-llm-429', ''], ['mock-llm', '']] as const) {
    const row = main.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
    const del = row.getByRole('button', { name: /^Delete/ });
    if (n) await shot(page, `${n}-delete-virtual-model`, del);
    await del.click();
    // The UI asks "Delete <name>? This cannot be undone." with a Delete model / Delete virtual model button.
    await page.getByRole('alertdialog').getByRole('button', { name: /^Delete (virtual )?model$/ }).click();
    await expect(row).toHaveCount(0);
    await page.waitForTimeout(1000);
  }
  const cfg = readConfig();
  expect(cfg.llm.virtualModels ?? []).toEqual([]);
  expect(cfg.llm.models.map((m: any) => m.name)).toEqual(['openai/*']);
});
