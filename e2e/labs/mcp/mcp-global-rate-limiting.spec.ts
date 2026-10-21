// labs/mcp/mcp-global-rate-limiting.md
// @fixture base
// @profiles ratelimit
// @docker yes
import { expect, test, type Page } from '@playwright/test';
import { helper, lab } from '../../lib/lab';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('mcp', 'mcp-global-rate-limiting');

test.describe.configure({ mode: 'serial' });

const card = (page: Page) => page.locator('main').getByRole('button', { name: /^(enabled|disabled)\s*Remote rate limit/ });

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('add a remote rate limit', async ({ page }) => {
  await go(page, '/mcp/policies');
  await shot(page, '01-policies', card(page));
  await card(page).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('agentgateway').fill('agentgateway');
  await d.getByPlaceholder('host:port or unix:/path/to/socket').fill('ratelimit:8081');
  await d.getByPlaceholder('key').fill('counter');
  const ed = d.locator('.monaco-editor:visible').first();
  await ed.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText('"mcp"');
  await page.waitForTimeout(800);
  await shot(page, '02-counter', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(card(page)).toContainText('enabled');
  expect(readConfig().mcp.policies.remoteRateLimit).toEqual({
    host: 'ratelimit:8081',
    domain: 'agentgateway',
    descriptors: [{ entries: [{ key: 'counter', value: '"mcp"' }] }],
  });
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
  const mcpPost = () => page.waitForResponse((r) => r.url().includes(':4001/mcp') && r.request().method() === 'POST', { timeout: 60_000 });

  // Initialize used 3 requests, so the limit of 5 runs out on the third call.
  const limited = main.locator('.mcp-text-output').getByText(/rate limit exceeded \(retry after \d+s; limit 5, remaining 0\)/);

  // First call: search results (a score only appears in real results).
  let resp = mcpPost();
  await call.click();
  let r = await resp;
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/Result 1 \(Score/);
  await expect(main.getByText(/Result 1 \(Score/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '03-first-call', call);

  // Second call: the fifth request, still results.
  resp = mcpPost();
  await call.click();
  r = await resp;
  expect(r.status()).toBe(200);
  const body2 = await r.text();
  expect(body2).toContain('"result":{"content"');
  expect(body2).not.toContain('"isError":true');
  await page.waitForTimeout(1000);
  await expect(limited).toHaveCount(0);

  // Third call: limited. HTTP 200 with a tool result marked as an error, not a 429.
  resp = mcpPost();
  await call.click();
  r = await resp;
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/"text":"rate limit exceeded \(retry after \d+s; limit 5, remaining 0\)"\}\],"isError":true/);
  await expect(limited).toBeVisible();
  await shot(page, '04-rate-limited', limited);
});

async function initialize(): Promise<string> {
  const res = await fetch('http://localhost:4001/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } } }),
  });
  return res.text();
}

test('restarting Redis starts the count over', async ({ page }) => {
  expect(await initialize()).toContain('rate limit exceeded');
  helper('stop', 'redis');
  helper('start', 'redis');
  // The rate limit service reconnects to Redis within a few seconds.
  await expect.poll(initialize, { timeout: 30_000, intervals: [2000] }).toContain('"serverInfo"');
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '05-turn-off-mcp', save));
});
