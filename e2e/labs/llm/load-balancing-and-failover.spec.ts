// labs/llm/load-balancing-and-failover.md
// @fixture llm-ready
// @profiles mock-llm,mock-llm-faults
// @docker yes
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { helper, lab } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'load-balancing-and-failover');
const PROMPT = 'Reply with the single word: pong';

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
  await d.getByRole('heading', { name: 'Add model' }).click();
  return d;
}

/** Sends the prompt to `resilient` in the open Chat Playground. Returns the HTTP status of the chat request. */
async function send(page: Page): Promise<number> {
  const main = page.locator('main');
  await main.getByPlaceholder('Ask a test question...').fill(PROMPT);
  const resp = page.waitForResponse((r) => r.url().includes(':4000/v1/chat/completions') && r.request().method() === 'POST', { timeout: 60_000 });
  await main.getByRole('button', { name: 'Send' }).click();
  const status = (await resp).status();
  await page.waitForTimeout(500);
  return status;
}

async function openPlayground(page: Page) {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'resilient' }).click();
}

test('add the healthy mock model', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '01-models', page.getByRole('button', { name: 'Add model', exact: true }).first());
  const d = await addMockModel(page, 'mock-llm');
  await shot(page, '02-add-mock-llm', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
});

test('add the failing mock model with a long eviction', async ({ page }) => {
  const d = await addMockModel(page, 'mock-llm-503');
  await d.getByRole('button', { name: /^Advanced/ }).click();
  await d.getByRole('button', { name: /^Model policies/ }).click();
  await d.getByRole('button', { name: /^Health/ }).click();
  await d.getByLabel('Eviction duration').fill('300s');
  await d.getByLabel('Consecutive failures').fill('1');
  await d.getByLabel('Consecutive failures').scrollIntoViewIfNeeded();
  await shot(page, '03-health-policy', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
  const m = readConfig().llm.models.find((x: any) => x.name === 'mock-llm-503');
  console.log(JSON.stringify(m));
  expect(m.health).toEqual({ eviction: { duration: '300s', consecutiveFailures: 1 } });
});

test('add the OpenAI backup model', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill('openai-backup');
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('OPENAI_API_KEY');
  await d.getByRole('button', { name: 'Explicit', exact: true }).click();
  await d.getByRole('combobox', { name: 'Explicit outgoing model' })
    .or(d.getByRole('textbox', { name: 'Explicit outgoing model' })).first().fill('gpt-4o-mini');
  await d.getByRole('heading', { name: 'Add model' }).click();
  await shot(page, '04-add-openai-backup', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
  const m = readConfig().llm.models.find((x: any) => x.name === 'openai-backup');
  console.log(JSON.stringify(m));
  expect(m.params.model).toBe('gpt-4o-mini');
});

test('add the resilient virtual model', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add virtual model', exact: true }).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('resilient').fill('resilient');
  await d.getByRole('button', { name: 'Failover', exact: true }).click();
  await d.getByRole('combobox', { name: 'Model' }).first().click();
  await page.getByRole('option', { name: 'mock-llm', exact: true }).click();
  await d.getByRole('button', { name: 'Add target' }).first().click();
  await d.getByRole('combobox', { name: 'Model' }).nth(1).click();
  await page.getByRole('option', { name: 'mock-llm-503', exact: true }).click();
  await d.getByRole('button', { name: 'Add fallback group' }).click();
  await d.getByRole('combobox', { name: 'Model' }).nth(2).click();
  await page.getByRole('option', { name: 'openai-backup', exact: true }).click();
  await expect(d).toContainText('Fallback group 2');
  await shot(page, '05-add-virtual-model', d.getByRole('button', { name: 'Save virtual model' }));
  await save(page, 'Save virtual model');
  const v = readConfig().llm.virtualModels;
  console.log(JSON.stringify(v));
  expect(v).toEqual([{ name: 'resilient', routing: { failover: { targets: [
    { model: 'mock-llm', priority: 0 }, { model: 'mock-llm-503', priority: 0 }, { model: 'openai-backup', priority: 1 },
  ] } } }]);
});

test('check it: the first group serves the requests', async ({ page }) => {
  await page.waitForTimeout(2000);
  await openPlayground(page);
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push(await send(page));
  console.log(statuses.join(' '));
  expect(statuses.filter((s) => s !== 200).length).toBeLessThanOrEqual(1);
  expect(statuses.slice(-3)).toEqual([200, 200, 200]);
  await shot(page, '06-playground-mock', page.locator('.chat-message.assistant').last());

  await go(page, '/llm/logs');
  const rows = page.locator('main tbody tr').filter({ hasText: 'resilient' });
  await expect(rows).toHaveCount(5, { timeout: 30_000 });
  const text = (await rows.allInnerTexts()).join('\n');
  console.log(text);
  expect(text).not.toMatch(/openai/i);
  await shot(page, '07-logs-group-1');
});

test('fail over to OpenAI when the first group is down', async ({ page }) => {
  helper('stop', 'mock-llm');
  await openPlayground(page);
  const t0 = Date.now();
  const first = await send(page);
  console.log(`first after stop: ${first} in ${(Date.now() - t0) / 1000}s`);
  expect(first).toBe(503);
  const main = page.locator('main');
  const banner = main.getByText('Playground request failed').locator('..');
  console.log(await banner.innerText());
  await shot(page, '08-connect-failed', banner);
  expect(await send(page)).toBe(200);
  const reply = page.locator('.chat-message.assistant').last();
  await expect(reply).toContainText(/pong/i);
  await shot(page, '09-playground-openai', reply);

  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: 'resilient' }).first();
  await expect(row).toContainText('200', { timeout: 30_000 });
  console.log(await row.innerText());
  await expect(row).toContainText(/gpt-4o-mini|openai/i);
  // The request that tried the stopped mock: a 503 that took about 11 seconds.
  const failed = page.locator('main tbody tr').filter({ hasText: 'resilient' }).filter({ hasText: '503' }).first();
  await expect(failed).toContainText(/1\d\.\d s/);
  await shot(page, '10-logs-openai');
});

test('clean up', async ({ page }) => {
  await go(page, '/llm/models');
  const main = page.locator('main');
  for (const name of ['resilient', 'mock-llm', 'mock-llm-503', 'openai-backup']) {
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
