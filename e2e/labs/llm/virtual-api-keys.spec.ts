// labs/llm/virtual-api-keys.md
// @fixture llm-ready
import { expect, test, type Page } from '@playwright/test';
import { chat, chatRequest, lab } from '../../lib/lab';
import { expectMatchesFixture } from '../../lib/config';

const { go, shot } = lab('llm', 'virtual-api-keys');

test.describe.configure({ mode: 'serial' });

const keys: Record<string, string> = {};

/** Creates a virtual key and returns the raw key from the one-time "Copy your new API key" panel. */
async function createKey(page: Page, name: string, shots = false): Promise<string> {
  const main = page.locator('main');
  const btn = main.getByRole('button', { name: 'New key' }).first();
  if (shots) await shot(page, '03-new-key', btn);
  await btn.click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Name' }).fill(name);
  if (shots) await shot(page, '04-create-key-alice', d.getByRole('button', { name: 'Save key' }));
  await d.getByRole('button', { name: 'Save key' }).click();
  const panel = page.getByText('Copy your new API key').locator('xpath=ancestor::*[.//button[normalize-space()="Done"]][1]');
  await expect(panel).toBeVisible();
  // The full key is 32 characters after the prefix; the list shows only a hint like agw_sk_...GAqK.
  const key = (await panel.innerText()).match(/agw_sk_[A-Za-z0-9]{20,}/)?.[0];
  expect(key, 'raw key shown once after saving').toBeTruthy();
  if (shots) await shot(page, '05-copy-key', panel.getByRole('button', { name: 'Copy' }));
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(main.getByRole('row', { name: new RegExp(`^${name}\\b`) })).toBeVisible();
  return key!;
}

test('enable API key authentication', async ({ page }) => {
  await go(page, '/llm/keys');
  const enable = page.locator('main').getByRole('button', { name: 'Enable API key auth' }).last();
  await shot(page, '01-keys-disabled', enable);
  await enable.click();
  const d = page.getByRole('dialog');
  const confirm = d.getByRole('button', { name: 'Enable API key auth' });
  await expect(d.getByRole('combobox', { name: 'Validation mode' })).toHaveText(/Strict/);
  await shot(page, '02-enable-dialog', confirm);
  await confirm.click();
  await expect(page.locator('main').getByRole('button', { name: 'New key' }).first()).toBeVisible();
});

test('create keys for alice and bob', async ({ page }) => {
  await go(page, '/llm/keys');
  keys.alice = await createKey(page, 'alice', true);
  keys.bob = await createKey(page, 'bob');
  expect(keys.alice).not.toBe(keys.bob);
  await shot(page, '06-keys-list');
});

test('a request without a key is rejected', async ({ page }) => {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-4o-mini');
  await main.getByPlaceholder('Ask a test question...').fill('Reply with the single word: pong');
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(main).toContainText('api key authentication failure: no API Key found', { timeout: 30_000 });
  await shot(page, '07-no-key-rejected', main.getByPlaceholder('Optional Bearer token'));

  const r = await chatRequest('openai/gpt-4o-mini', 'Hello from agentgateway');
  expect(r.status).toBe(401);
});

test("alice's key is accepted", async ({ page }) => {
  await go(page, '/llm/playground');
  const reply = await chat(page, { model: 'openai/*', specific: 'gpt-4o-mini', prompt: 'Reply with the single word: pong', apiKey: keys.alice });
  expect(reply).toContain('OK');
  await shot(page, '08-alice-ok', page.locator('.chat-message.assistant').last());

  const r = await chatRequest('openai/gpt-4o-mini', 'Hello from agentgateway', { authorization: `Bearer ${keys.bob}` });
  expect(r.status).toBe(200);
  const bad = await chatRequest('openai/gpt-4o-mini', 'Hello from agentgateway', { authorization: 'Bearer agw_sk_not-a-real-key' });
  expect(bad.status).toBe(401);
});

test('Logs and Analytics show the user', async ({ page }) => {
  await go(page, '/llm/logs');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'All users' }).click();
  const alice = page.getByRole('checkbox', { name: 'alice' });
  await expect(alice).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('checkbox', { name: 'bob' })).toBeVisible();
  await alice.check();
  await page.keyboard.press('Escape');
  const row = main.getByText('openai/gpt-4o-mini').first();
  await expect(row).toBeVisible();
  await expect(main).toContainText('Showing 1 recent calls');
  await shot(page, '09-logs-alice', row);
  await row.click();
  // The detail panel's raw log JSON carries the user the gateway took from the key.
  await expect(main).toContainText(/"agentgateway\.user":\s*"alice"/);
  await expect(main).toContainText(/"agw\.api_key\.name":\s*"alice"/);
  await main.getByText('Prompt logging is off').scrollIntoViewIfNeeded();
  await shot(page, '10-log-detail');

  await go(page, '/llm/analytics');
  await main.getByRole('button', { name: 'Total' }).click();
  await page.getByRole('checkbox', { name: 'User', exact: true }).check();
  await main.getByRole('heading', { name: 'Analytics' }).click();
  await expect(page.getByRole('checkbox', { name: 'User', exact: true })).toBeHidden();
  await expect(main).toContainText('alice');
  await expect(main).toContainText('bob');
  await shot(page, '11-analytics-by-user');
});

test('clean up: delete the keys and disable API key auth', async ({ page }) => {
  await go(page, '/llm/keys');
  const main = page.locator('main');
  for (const name of ['alice', 'bob']) {
    const row = main.getByRole('row', { name: new RegExp(`^${name}\\b`) });
    await row.getByRole('button', { name: 'Delete key' }).click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete key' }).click();
    await expect(row).toBeHidden();
  }
  // The lab says Disable API Key Policy appears once both keys are deleted.
  const disable = main.getByRole('button', { name: 'Disable API Key Policy' });
  await expect(disable).toBeVisible();
  await expect(main).toContainText('No virtual API keys');
  await shot(page, '12-disable-policy', disable);
  await disable.click();
  await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Disable API Key Policy' }).click();
  await expect(main.getByRole('button', { name: 'Enable API key auth' }).first()).toBeVisible();
  await page.waitForTimeout(1000);
  expectMatchesFixture('llm-ready');
});
