// labs/llm/external-authorization.md
// @fixture llm-ready
// @profiles ext-authz
import { expect, type Locator, type Page, test } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('llm', 'external-authorization');
const PROMPT = 'Reply with the single word: pong';
const DENY_MSG = 'denied by ext_authz: header `x-ext-authz: allow` not found in request';

test.describe.configure({ mode: 'serial' });

/** Runs the lab's curl, with an optional extra header line. Returns the full response with headers. */
function curl(header = ''): string {
  return sh(`curl -si http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  ${header ? `-H "${header}" ` : ''}-d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"${PROMPT}"}]}'`).stdout;
}

async function policyCard(page: Page, title: string): Promise<Locator> {
  await go(page, '/llm/policies');
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${title}\\b`) });
}

test('add the External authz policy', async ({ page }) => {
  const card = await policyCard(page, 'External authz');
  await shot(page, '01-policies-extauthz-card', card);
  await card.click();

  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Host' }).fill('ext-authz:9000');
  await expect(d.getByRole('combobox', { name: 'Protocol' })).toHaveText('gRPC');
  await expect(d.getByRole('combobox', { name: 'Failure mode' })).toHaveText('Deny');
  await shot(page, '02-extauthz-form', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const p = readConfig().llm.policies.extAuthz;
  expect(p.host).toBe('ext-authz:9000');
  expect(p.failureMode).toBe('deny');
  expect(p.protocol.grpc).toBeTruthy();
});

test('the Chat Playground is denied without the header', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-4o-mini');
  await main.getByPlaceholder('Ask a test question...').fill(PROMPT);
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed').locator('..');
  await expect(banner).toContainText(DENY_MSG, { timeout: 30_000 });
  await shot(page, '03-playground-denied', banner);
});

test('curl: 403 without the header, 200 with it', async () => {
  const denied = curl();
  expect(denied).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  expect(denied).toContain('x-ext-authz-check-result: denied');
  expect(denied.trimEnd().endsWith(DENY_MSG)).toBeTruthy();
  const allowed = curl('x-ext-authz: allow');
  expect(allowed).toMatch(/^HTTP\/1\.1 200 OK/);
  expect(allowed).toContain('"role":"assistant"');
});

test('clean up: delete the policy', async ({ page }) => {
  const card = await policyCard(page, 'External authz');
  await card.click();
  const del = page.getByRole('dialog').getByRole('button', { name: 'Delete policy' });
  await shot(page, '04-delete-policy', del);
  await del.click();
  await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
  await expect(page.locator('aside.drawer')).toBeHidden();
  await page.waitForTimeout(1000);
  await expect(card).toContainText('disabled');
  expect(readConfig().llm.policies.extAuthz).toBeUndefined();
  expect(curl()).toMatch(/^HTTP\/1\.1 200 OK/);
});
