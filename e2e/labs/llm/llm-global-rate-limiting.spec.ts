// labs/llm/llm-global-rate-limiting.md
// @fixture base
// @profiles ratelimit
// @docker yes
import { expect, test, type Page } from '@playwright/test';
import { helper, lab, labSh, sh } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';
import { expectMatchesFixture, readConfig } from '../../lib/config';

const { go, shot, save } = lab('llm', 'llm-global-rate-limiting');

test.describe.configure({ mode: 'serial' });

const card = (page: Page) => page.locator('main').getByRole('button', { name: /Remote rate limit/ });

/** The rule counts per minute, so start a counting block early in the minute. */
async function startOfMinute(page: Page): Promise<void> {
  const s = new Date().getSeconds();
  if (s > 35) await page.waitForTimeout((61 - s) * 1000);
}

/** Replaces the text of the first CEL editor in the panel. insertText skips the editor's auto-complete. */
async function setValue(page: Page, cel: string): Promise<void> {
  const ed = page.getByRole('dialog').locator('.monaco-editor:visible').first();
  await ed.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(cel);
  // The editor reports its value after a short debounce.
  await page.waitForTimeout(800);
}

/** One request that the lab does not show, to check the limit or log the error body. */
function chat(user?: string) {
  const h = user ? `-H 'x-user: ${user}'` : '';
  const r = sh(`curl -s -w '\\n%{http_code}' http://localhost:4000/v1/chat/completions -H 'Content-Type: application/json' ${h} \\
  -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}'`);
  const lines = r.stdout.trim().split('\n');
  return { status: Number(lines.pop()), body: lines.join('\n') };
}

// The lab's commands.
const SIX_REQUESTS = `for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "request $i: HTTP %{http_code}\\n" http://localhost:4000/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}'
done`;
const PER_USER = `for user in alice alice alice alice bob; do
  curl -s -o /dev/null -w "$user: HTTP %{http_code}\\n" http://localhost:4000/v1/chat/completions \\
    -H "Content-Type: application/json" -H "x-user: $user" \\
    -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}'
done`;
const TEN_REQUESTS = `for i in $(seq 1 10); do
  curl -s -o /dev/null -w "request $i: HTTP %{http_code}\\n" http://localhost:4000/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}'
done`;
const ONE_REQUEST = `curl -s -w '\\nHTTP %{http_code}\\n' http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Say hi"}],"max_tokens":5}'`;

/** Runs a lab command and returns its output lines. */
function run(cmd: string): string[] {
  return labSh(cmd).stdout.trim().split('\n');
}

test('set up', async ({ page }) => {
  await addOpenAIModel(page);
});

test('add a shared request counter', async ({ page }) => {
  await go(page, '/llm/policies');
  await expect(card(page)).toContainText('disabled');
  await shot(page, '01-policies', card(page));
  await card(page).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('agentgateway').fill('agentgateway');
  await expect(d.getByRole('combobox', { name: 'Failure mode' })).toHaveText(/Fail closed/);
  await d.getByPlaceholder('host:port or unix:/path/to/socket').fill('ratelimit:8081');
  await expect(d.getByRole('combobox', { name: 'Descriptor 1 type' })).toHaveText(/Requests/);
  await d.getByPlaceholder('key').fill('counter');
  await setValue(page, '"all"');
  await shot(page, '02-counter', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/llm/policies');
  await expect(card(page)).toContainText('enabled');
  expect(readConfig().llm.policies.remoteRateLimit).toEqual({
    host: 'ratelimit:8081',
    domain: 'agentgateway',
    descriptors: [{ entries: [{ key: 'counter', value: '"all"' }] }],
  });
  await shot(page, '03-enabled', card(page));
});

test('the sixth request gets 429', async ({ page }) => {
  await page.waitForTimeout(2000);
  await startOfMinute(page);
  expect(run(SIX_REQUESTS)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `request ${i}: HTTP ${i < 6 ? 200 : 429}`));
  const blocked = chat();
  expect(blocked.status).toBe(429);
  console.log('429 body:', JSON.stringify(blocked.body));

  await go(page, '/llm/logs');
  // The gateway rejects the request before it reads the model, so the row says "unknown model".
  const row = page.locator('main tbody tr').first();
  await expect(row).toContainText('429', { timeout: 30_000 });
  await expect(row).toContainText('rate limit exceeded');
  await expect(row).toContainText('unknown model');
  await shot(page, '04-logs-429', row);
});

test('one counter for each user', async ({ page }) => {
  await go(page, '/llm/policies');
  await card(page).click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('key').fill('user');
  await setValue(page, 'request.headers["x-user"]');
  await shot(page, '05-per-user', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await page.waitForTimeout(2000);
  expect(readConfig().llm.policies.remoteRateLimit.descriptors).toEqual([{ entries: [{ key: 'user', value: 'request.headers["x-user"]' }] }]);

  await startOfMinute(page);
  expect(run(PER_USER)).toEqual(['alice: HTTP 200', 'alice: HTTP 200', 'alice: HTTP 200', 'alice: HTTP 429', 'bob: HTTP 200']);
});

test('count tokens', async ({ page }) => {
  await go(page, '/llm/policies');
  await card(page).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Descriptor 1 type' }).click();
  await page.getByRole('option', { name: /^Tokens/ }).click();
  await d.getByPlaceholder('key').fill('tokens');
  await setValue(page, '"all"');
  await shot(page, '06-tokens', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await page.waitForTimeout(2000);
  expect(readConfig().llm.policies.remoteRateLimit.descriptors).toEqual([{ type: 'tokens', entries: [{ key: 'tokens', value: '"all"' }] }]);

  await startOfMinute(page);
  const out = run(TEN_REQUESTS);
  console.log('token codes:', out.join(','));
  // Each request uses 13 tokens (8 in, 5 out). The service adds them after the response, so the fifth request
  // takes the count past 60 and still passes, and the sixth is blocked.
  expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `request ${i}: HTTP ${i < 6 ? 200 : 429}`));
});

test('fail closed and fail open', async ({ page }) => {
  await go(page, '/llm/policies');
  await card(page).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Descriptor 1 type' }).click();
  await page.getByRole('option', { name: /^Requests/ }).click();
  await d.getByPlaceholder('key').fill('counter');
  await setValue(page, '"all"');
  await save(page, 'Save policy');
  await page.waitForTimeout(2000);

  helper('stop', 'ratelimit');
  await page.waitForTimeout(1000);
  const closed = run(ONE_REQUEST);
  console.log('fail closed:', JSON.stringify(closed));
  expect(closed).toEqual(['rate limit failed', 'HTTP 500']);

  await go(page, '/llm/policies');
  await card(page).click();
  await d.getByRole('combobox', { name: 'Failure mode' }).click();
  await page.getByRole('option', { name: /^Fail open/ }).click();
  await shot(page, '07-fail-open', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await page.waitForTimeout(2000);
  expect(readConfig().llm.policies.remoteRateLimit.failureMode).toBe('failOpen');
  expect(run(ONE_REQUEST).at(-1)).toBe('HTTP 200');

  helper('start', 'ratelimit');
});

test('clean up: delete the policy and the model', async ({ page }) => {
  await go(page, '/llm/policies');
  await card(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete policy', exact: true }).last().click();
  await expect(card(page)).toContainText('disabled');
  await page.waitForTimeout(1000);
  await deleteModel(page);
  expectMatchesFixture('base');
});
