// labs/llm/local-rate-limiting.md
// @fixture llm-ready
import { expect, test } from '@playwright/test';
import { chat, chatRequest, lab } from '../../lib/lab';
import { expectMatchesFixture, readConfig } from '../../lib/config';

const { go, shot } = lab('llm', 'local-rate-limiting');

test.describe.configure({ mode: 'serial' });

test('add a local token rate limit', async ({ page }) => {
  await go(page, '/llm/policies');
  const main = page.locator('main');
  const card = main.getByRole('button', { name: /Local rate limit/ });
  await expect(card).toContainText('disabled');
  await shot(page, '01-policies', card);
  await card.click();

  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Limit type' }).click();
  await page.getByRole('option', { name: /^Tokens/ }).click();
  await expect(d.getByRole('combobox', { name: 'Limit type' })).toHaveText(/Tokens/);
  await expect(d.getByPlaceholder('60s')).toHaveValue('60s');
  await d.getByRole('spinbutton', { name: 'Max tokens' }).fill('10');
  await d.getByRole('spinbutton', { name: 'Tokens per fill' }).fill('10');
  const save = d.getByRole('button', { name: 'Save policy' });
  await shot(page, '02-token-limit', save);
  await save.click();
  await expect(d).toBeHidden();
  await expect(card).toContainText('enabled');
  await expect(card).toContainText('tokens every 60s');
  await page.waitForTimeout(1000);
  expect(readConfig().llm.policies.localRateLimit).toEqual([{ type: 'tokens', fillInterval: '60s', maxTokens: 10, tokensPerFill: 10 }]);
  await shot(page, '03-policy-enabled', card);
});

test('the first request passes, the second gets 429', async ({ page }) => {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await chat(page, { model: 'openai/*', specific: 'gpt-4o-mini', prompt: 'Reply with the single word: pong' });
  // The status chip, not the reply text, so a model reply that says "OK" cannot pass.
  await expect(main.locator('.chat-message.assistant').last().locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  await main.getByPlaceholder('Ask a test question...').fill('Reply with the single word: pong');
  await main.getByRole('button', { name: 'Send' }).click();
  const err = main.getByText('rate limit exceeded', { exact: true });
  await expect(err).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText('Playground request failed');
  await shot(page, '04-rate-limited', err);
});

test('see the 429 in Logs', async ({ page }) => {
  await go(page, '/llm/logs');
  const main = page.locator('main');
  // Only the two playground requests, newest first: the 429, then the 200 that reached OpenAI.
  // The browser's preflight shows as a separate "unknown model" row, which the lab says to ignore.
  const rows = main.locator('tbody tr').filter({ hasText: 'openai/gpt-4o-mini' });
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(rows.nth(0)).toContainText('429');
  await expect(rows.nth(0)).toContainText('rate limit exceeded');
  await expect(rows.nth(1)).toContainText('200');
  await expect(rows.nth(1)).toContainText('$0.0000');
  await shot(page, '05-logs-429', rows.nth(0).getByText('rate limit exceeded'));

  // The optional curl, after the screenshot so its row does not show in it. Still within a minute of Step 2.
  const r = await chatRequest('openai/gpt-4o-mini', 'Hello from agentgateway');
  expect(r.status).toBe(429);
  expect(r.text).toContain('rate limit exceeded');
});

test('clean up: delete the policy', async ({ page }) => {
  await go(page, '/llm/policies');
  const main = page.locator('main');
  const card = main.getByRole('button', { name: /Local rate limit/ });
  await card.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete policy', exact: true }).last().click();
  await expect(card).toContainText('disabled');
  await page.waitForTimeout(1000);
  expectMatchesFixture('llm-ready');
});
