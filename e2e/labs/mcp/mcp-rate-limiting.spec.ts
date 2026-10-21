// labs/mcp/mcp-rate-limiting.md
// @fixture base
import { expect, test, type Page } from '@playwright/test';
import { lab, labSh } from '../../lib/lab';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-rate-limiting');

test.describe.configure({ mode: 'serial' });

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('add a local rate limit', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'Local rate limit');
  await shot(page, '01-policies', card);
  await card.click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('combobox', { name: 'Limit type' })).toHaveText(/Requests/);
  await d.getByRole('textbox', { name: 'Fill interval' }).fill('300s');
  await d.getByRole('spinbutton', { name: 'Max tokens' }).fill('5');
  await d.getByRole('spinbutton', { name: 'Tokens per fill' }).fill('5');
  await shot(page, '02-rate-limit', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'Local rate limit')).toContainText('enabled');
});

test('Tool Playground hits the limit', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 30_000 });
  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: /^search/ }).first().click();
  await main.getByRole('textbox', { name: /query/ }).fill('rate limiting');
  await main.getByRole('combobox', { name: 'product' }).click();
  await page.getByRole('option', { name: 'solo-enterprise-for-agentgateway' }).click();
  const call = main.getByRole('button', { name: 'Call tool' });

  // First call: search results (a score only appears in real results).
  await call.click();
  const firstHit = main.getByText(/Result 1 \(Score/).first();
  await expect(firstHit).toBeVisible({ timeout: 60_000 });
  await shot(page, '03-first-call', call);

  // Initialize used 3 requests and the first call 1, so the limit of 5 runs out on exactly the third call.
  const limited = main.locator('.mcp-text-output').getByText(/rate limit exceeded \(retry after \d+s; limit 5, remaining 0\)/);
  const mcpPost = () => page.waitForResponse((r) => r.url().includes(':4001/mcp') && r.request().method() === 'POST', { timeout: 60_000 });

  // Second call: uses the fifth request and returns results (HTTP 200, a scored result, no rate limit error).
  let resp = mcpPost();
  await call.click();
  let r = await resp;
  expect(r.status()).toBe(200);
  let body = await r.text();
  // The search results themselves can mention "rate limit exceeded", so check the JSON-RPC shape instead.
  expect(body).toContain('"result":{"content"');
  expect(body).toMatch(/Result 1 \(Score/);
  expect(body).not.toContain('"isError":true');
  await page.waitForTimeout(1000);
  await expect(limited).toHaveCount(0);

  // Third call: rate limited. The gateway answers HTTP 200 with a tool result marked as an error, not a 429.
  resp = mcpPost();
  await call.click();
  r = await resp;
  expect(r.status()).toBe(200);
  body = await r.text();
  expect(body).toMatch(/"text":"rate limit exceeded \(retry after \d+s; limit 5, remaining 0\)"\}\],"isError":true/);
  await expect(limited).toBeVisible();
  await shot(page, '04-rate-limited', limited);
});

test('optional curl check', async () => {
  const r = labSh(`curl -s -i http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'`);
  expect(r.stdout).toMatch(/^HTTP\/1\.1 200 OK/);
  expect(r.stdout).toContain('x-ratelimit-limit: 5');
  expect(r.stdout).toContain('x-ratelimit-remaining: 0');
  expect(r.stdout).toContain('"code":-32003,"message":"rate limit exceeded"');
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '05-turn-off-mcp', save));
});
