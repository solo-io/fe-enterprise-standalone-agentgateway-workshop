// labs/llm/budgets-and-cost-tracking.md
// @fixture base
import { expect, test } from '@playwright/test';
import { chat, chatRequest, lab } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';
import { expectMatchesFixture, readConfig } from '../../lib/config';

const { go, shot } = lab('llm', 'budgets-and-cost-tracking');

test.describe.configure({ mode: 'serial' });

test('set up', async ({ page }) => {
  await addOpenAIModel(page);
});

test('add a custom price for gpt-6-luna to the cost catalog', async ({ page }) => {
  await go(page, '/llm/budgets');
  const main = page.locator('main');
  const tab = main.getByRole('tab', { name: 'Cost catalog' });
  await expect(main.getByRole('tab', { name: 'Budgets' })).toHaveAttribute('aria-selected', 'true');
  await expect(main).toContainText('No budgets configured');
  await shot(page, '01-budgets-empty', tab);
  await tab.click();
  await expect(main).toContainText('/config/base-costs.json');
  const edit = main.getByRole('button', { name: 'Edit', exact: true });
  await shot(page, '02-cost-catalog', edit);
  await edit.click();
  await main.getByRole('button', { name: 'Add model cost' }).click();
  await main.getByPlaceholder('openai', { exact: true }).fill('openai');
  await main.getByPlaceholder('gpt-5-mini').fill('gpt-6-luna');
  await main.getByPlaceholder('0.25').fill('0.10');
  await main.getByPlaceholder('2.00').fill('0.50');
  const save = main.getByRole('button', { name: 'Save', exact: true });
  await shot(page, '03-add-model-cost', save);
  await save.click();
  await expect(main.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(main.getByRole('row', { name: /gpt-6-luna/ })).toContainText('0.10');
  await page.waitForTimeout(1000);
  expect(JSON.stringify(readConfig())).toContain('gpt-6-luna');
  await shot(page, '04-custom-cost-saved', main.getByRole('cell', { name: 'gpt-6-luna', exact: true }));
});

test('create a 10-token budget that blocks', async ({ page }) => {
  await go(page, '/llm/budgets');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'New budget' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /^Name/ }).fill('workshop');
  await expect(d.getByRole('combobox', { name: 'Budget limit unit' })).toHaveText(/Tokens/);
  await d.getByRole('spinbutton', { name: 'Limit amount' }).fill('10');
  await expect(d.getByPlaceholder('24h')).toHaveValue('1h');
  await expect(d.getByRole('radio', { name: /Block requests/ })).toHaveAttribute('aria-checked', 'true');
  const create = d.getByRole('button', { name: 'Create budget' });
  await shot(page, '05-create-budget', create);
  await create.click();
  const row = main.getByRole('row', { name: /workshop/ });
  await expect(row).toContainText('All requests');
  await expect(row).toContainText('10 tokens');
  await expect(row).toContainText('No usage yet');
  // Focus returns to New budget when the panel closes, which shows its tooltip; drop it for the screenshot.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await shot(page, '06-budget-created', row.getByText('No usage yet'));
});

test('the first request passes, the next one gets 429', async ({ page }) => {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: 'Reply with the single word: pong' });
  // The status chip, not the reply text, so a model reply that says "OK" cannot pass.
  await expect(main.locator('.chat-message.assistant').last().locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  await main.getByPlaceholder('Ask a test question...').fill('Reply with the single word: pong');
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(main).toContainText('"code":"budget_exceeded"', { timeout: 30_000 });
  await shot(page, '07-budget-exceeded');
});

test('see usage on the budget and spend in Analytics', async ({ page }) => {
  await go(page, '/llm/budgets');
  const main = page.locator('main');
  const usage = main.getByRole('button', { name: 'View usage details for workshop' });
  await expect(usage).toContainText(/\d+% used/);
  // The lab says "more than 100% used": one request uses about 26 of the 10 tokens.
  const pct = Number((await usage.innerText()).match(/(\d+)% used/)![1]);
  expect(pct).toBeGreaterThan(100);
  await shot(page, '08-budget-used', usage);

  await go(page, '/llm/logs');
  // Only the two playground requests, newest first: the 429, then the 200 that reached OpenAI.
  // The browser's preflight shows as a separate "unknown model" row, which the lab says to ignore.
  const rows = main.locator('tbody tr').filter({ hasText: 'openai/gpt-6-luna' });
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(rows.nth(0)).toContainText('429');
  await expect(rows.nth(0)).toContainText('Budget exceeded');
  await expect(rows.nth(1)).toContainText('200');
  await expect(rows.nth(1)).toContainText('$0.0000');
  await shot(page, '09-logs-429', rows.nth(0).getByText('Budget exceeded'));

  await go(page, '/llm/analytics');
  await main.getByRole('combobox', { name: 'Measure' }).click();
  await page.getByRole('option', { name: 'Cost' }).click();
  const summary = main.getByText(/^\$0\.0000\d+ \/ \d+ tokens \/ \d+ calls$/);
  await expect(summary).toBeVisible();
  await shot(page, '10-analytics-cost', summary);

  // The optional curl, after the screenshots so it does not change them.
  const r = await chatRequest('openai/gpt-6-luna', 'Hello from agentgateway');
  expect(r.status).toBe(429);
  expect(r.text).toContain('budget_exceeded');
});

test('clean up: delete the budget and the custom cost', async ({ page }) => {
  await go(page, '/llm/budgets');
  const main = page.locator('main');
  const row = main.getByRole('row', { name: /workshop/ });
  await row.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete budget' }).click();
  await expect(main).toContainText('No budgets configured');

  await main.getByRole('tab', { name: 'Cost catalog' }).click();
  await main.getByRole('button', { name: 'Edit', exact: true }).click();
  await main.getByRole('button', { name: 'Remove custom cost' }).click();
  await main.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(main).toContainText('No custom costs.');
  await page.waitForTimeout(1000);
  await deleteModel(page);
  expectMatchesFixture('base');
});
