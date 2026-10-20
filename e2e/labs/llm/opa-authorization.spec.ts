// labs/llm/opa-authorization.md
// @fixture llm-ready
// @profiles opa
// @docker yes
import { expect, type Locator, type Page, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { chat, helperLogs, lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('llm', 'opa-authorization');
const PROMPT = 'Reply with the single word: pong';
const POLICY = '/work/opa/policy.rego';
const ALICE = readFileSync('/repo/lib/jwt/tokens/alice.jwt', 'utf8').trim();
const BOB = readFileSync('/repo/lib/jwt/tokens/bob.jwt', 'utf8').trim();

test.describe.configure({ mode: 'serial' });

/** Runs the lab's curl for a model, with an optional token. Returns the full response with headers. */
function curl(model: string, token = ''): string {
  return sh(`curl -si http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  ${token ? `-H "Authorization: Bearer ${token}" ` : ''}-d '{"model":"openai/${model}","messages":[{"role":"user","content":"${PROMPT}"}]}'`).stdout;
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
  await d.getByRole('textbox', { name: 'Host' }).fill('opa:9000');
  await d.getByText('Include request body').click();
  await d.getByRole('spinbutton', { name: 'Max request bytes' }).or(d.getByRole('textbox', { name: 'Max request bytes' })).fill('8192');
  await expect(d.getByRole('combobox', { name: 'Protocol' })).toHaveText('gRPC');
  await expect(d.getByRole('combobox', { name: 'Failure mode' })).toHaveText('Deny');
  await shot(page, '02-extauthz-form', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const p = readConfig().llm.policies.extAuthz;
  expect(p.host).toBe('opa:9000');
  expect(p.failureMode).toBe('deny');
  expect(p.includeRequestBody.maxRequestBytes).toBe(8192);
});

test('the Chat Playground is denied without a token', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-6-luna');
  await main.getByPlaceholder('Ask a test question...').fill(PROMPT);
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed').locator('..');
  await expect(banner).toContainText('denied by OPA: send a valid workshop token', { timeout: 30_000 });
  await shot(page, '03-playground-denied', banner);
});

test('the Chat Playground with bob and alice tokens', async ({ page }) => {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-6.1-sol');
  await main.getByPlaceholder('Optional Bearer token').fill(BOB);
  await main.getByPlaceholder('Ask a test question...').fill(PROMPT);
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed').locator('..');
  await expect(banner).toContainText('denied by OPA: team marketing may not use model openai/gpt-6.1-sol', { timeout: 30_000 });
  await shot(page, '04-playground-bob-denied', banner);

  await go(page, '/llm/playground');
  const reply = await chat(page, { model: 'openai/*', specific: 'gpt-6.1-sol', prompt: PROMPT, apiKey: ALICE });
  expect(reply).toContain('OK');
  await shot(page, '05-playground-alice-allowed', page.locator('main').locator('.chat-message.assistant').last());
});

test('curl: tokens and models', async () => {
  const none = curl('gpt-6-luna');
  expect(none).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  expect(none.trimEnd().endsWith('denied by OPA: send a valid workshop token')).toBeTruthy();

  const bobMini = curl('gpt-6-luna', BOB);
  expect(bobMini).toMatch(/^HTTP\/1\.1 200 OK/);

  const bobOther = curl('gpt-6.1-sol', BOB);
  expect(bobOther).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  expect(bobOther.trimEnd().endsWith('denied by OPA: team marketing may not use model openai/gpt-6.1-sol')).toBeTruthy();

  const alice = curl('gpt-6.1-sol', ALICE);
  expect(alice).toMatch(/^HTTP\/1\.1 200 OK/);
});

test('the OPA decision log', async () => {
  const log = helperLogs('opa');
  expect(log).toContain('"decision_id"');
  expect(log).toContain('"allowed":false');
  expect(log).toContain('"allowed":true');
});

test('change the policy without touching the gateway', async () => {
  const orig = readFileSync(POLICY, 'utf8');
  const edited = orig.replace('{"openai/gpt-6-luna"}', '{"openai/gpt-6-luna", "openai/gpt-6.1-sol"}');
  expect(edited).not.toBe(orig);
  writeFileSync(POLICY, edited);
  await new Promise((r) => setTimeout(r, 5000));
  expect(curl('gpt-6.1-sol', BOB)).toMatch(/^HTTP\/1\.1 200 OK/);
});

test('clean up: delete the policy', async ({ page }) => {
  writeFileSync(POLICY, readFileSync(POLICY, 'utf8').replace('{"openai/gpt-6-luna", "openai/gpt-6.1-sol"}', '{"openai/gpt-6-luna"}'));
  expect(readFileSync(POLICY, 'utf8')).toBe(readFileSync('/repo/setup/opa/policy.rego', 'utf8'));

  const card = await policyCard(page, 'External authz');
  await card.click();
  const del = page.getByRole('dialog').getByRole('button', { name: 'Delete policy' });
  await shot(page, '06-delete-policy', del);
  await del.click();
  await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
  await expect(page.locator('aside.drawer')).toBeHidden();
  await page.waitForTimeout(1000);
  await expect(card).toContainText('disabled');
  expect(readConfig().llm.policies.extAuthz).toBeUndefined();
  expect(curl('gpt-6-luna')).toMatch(/^HTTP\/1\.1 200 OK/);
});
