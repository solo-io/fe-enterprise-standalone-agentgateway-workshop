// labs/llm/builtin-guardrails.md
// @fixture llm-ready
import { expect, test, type Page } from '@playwright/test';
import { chat, chatRequest, lab } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('llm', 'builtin-guardrails');

test.describe.configure({ mode: 'serial' });

const PII_BODY = 'Request blocked: credit card or SSN detected.';
const KEY_BODY = 'Request blocked: AWS access key detected.';
const CARD_PROMPT = 'My card number is 4111 1111 1111 1111. Is it valid?';
const KEY_PROMPT = 'Here is my AWS key AKIAIOSFODNN7EXAMPLE. Is the format right?';
const EMAIL = 'jane.doe@example.com';
const EMAIL_PROMPT = `Repeat this sentence exactly, with no other text: Contact ${EMAIL} today.`;

/** Opens the Add guard panel for request (index 0) or response (index 1) guards and picks the guard type. */
async function addGuard(page: Page, which: 'request' | 'response', type: string, shotName?: string) {
  const btn = page.locator('main').getByRole('button', { name: 'Add guard', exact: true }).nth(which === 'request' ? 0 : 1);
  if (shotName) await shot(page, shotName, btn);
  await btn.click();
  const d = page.getByRole('dialog');
  await expect(d).toContainText(which === 'request' ? 'Add request guard' : 'Add response guard');
  await d.getByRole('combobox', { name: 'Guard type' }).click();
  await page.getByRole('option', { name: new RegExp('^' + type) }).click();
  return d;
}

/** Sends one prompt in the Chat Playground (already open) that the gateway rejects; returns the page text. */
async function sendBlocked(page: Page, prompt: string, body: string) {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'openai/*' }).first().click();
  await main.getByPlaceholder('Select or type a model').fill('gpt-6-luna');
  await main.getByPlaceholder('Ask a test question...').fill(prompt);
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(main.getByText('Playground request failed')).toBeVisible({ timeout: 30_000 });
  await expect(main).toContainText(body);
}

test('add the request and response guards', async ({ page }) => {
  await go(page, '/llm/guardrails');
  await expect(page.locator('main')).toContainText('No guards configured.');

  // Guard 1: built-in detectors for credit cards and SSNs, reject with 422.
  let d = await addGuard(page, 'request', 'Built-in detectors', '01-guardrails-empty');
  await expect(d.getByRole('combobox', { name: 'Action' })).toHaveText(/Reject request/);
  const email = d.getByRole('button', { name: 'Email', exact: true });
  await expect(email).toHaveClass(/active/);
  await email.click();
  await expect(email).not.toHaveClass(/active/);
  await d.getByRole('button', { name: 'Credit card', exact: true }).click();
  await d.getByRole('button', { name: 'SSN', exact: true }).click();
  await d.getByPlaceholder('403').fill('422');
  await d.getByPlaceholder('The request was rejected due to inappropriate content').fill(PII_BODY);
  await shot(page, '02-builtin-detectors', d.getByRole('button', { name: 'Add guard' }));
  await d.getByRole('button', { name: 'Add guard' }).click();
  await expect(d).toBeHidden();

  // Guard 2: a custom regex for AWS access key IDs.
  d = await addGuard(page, 'request', 'Custom regex');
  await d.getByPlaceholder('(?i)secret-[a-z0-9]+').fill('AKIA[0-9A-Z]{16}');
  await d.getByPlaceholder('The request was rejected due to inappropriate content').fill(KEY_BODY);
  await shot(page, '03-custom-regex', d.getByRole('button', { name: 'Add guard' }));
  await d.getByRole('button', { name: 'Add guard' }).click();
  await expect(d).toBeHidden();

  // Guard 3: a response guard that masks email addresses.
  d = await addGuard(page, 'response', 'Built-in detectors', '04-add-response-guard');
  await d.getByRole('combobox', { name: 'Action' }).click();
  await page.getByRole('option', { name: /^Mask matched text/ }).click();
  await expect(d.getByRole('button', { name: 'Email', exact: true })).toHaveClass(/active/);
  await shot(page, '05-mask-email', d.getByRole('button', { name: 'Add guard' }));
  await d.getByRole('button', { name: 'Add guard' }).click();
  await expect(d).toBeHidden();

  const main = page.locator('main');
  await expect(main).toContainText('Reject 2 built-in detectors. Rejects with 422.');
  await expect(main).toContainText('Reject 1 regex pattern.');
  await expect(main).toContainText('Mask 1 built-in detector.');
  const saveBtn = page.getByRole('button', { name: 'Save guardrails' });
  await shot(page, '06-save-guardrails', saveBtn);
  await save(page, saveBtn);
  await expect(saveBtn).toBeHidden();
  // The YAML shown under "What the UI wrote".
  expect(readConfig().llm.policies.guardrails).toEqual({
    request: [
      { regex: { action: 'reject', rules: [{ builtin: 'creditCard' }, { builtin: 'ssn' }] }, rejection: { status: 422, body: PII_BODY } },
      { regex: { action: 'reject', rules: [{ pattern: 'AKIA[0-9A-Z]{16}' }] }, rejection: { body: KEY_BODY } },
    ],
    response: [{ regex: { action: 'mask', rules: [{ builtin: 'email' }] } }],
  });
});

test('the gateway blocks a credit card and an AWS key', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  await sendBlocked(page, CARD_PROMPT, PII_BODY);
  await shot(page, '07-blocked-card');
  await go(page, '/llm/playground');
  await sendBlocked(page, KEY_PROMPT, KEY_BODY);
  await shot(page, '08-blocked-aws-key');

  const card = await chatRequest('openai/gpt-6-luna', CARD_PROMPT);
  expect(card).toEqual({ status: 422, text: PII_BODY });
  const key = await chatRequest('openai/gpt-6-luna', KEY_PROMPT);
  expect(key).toEqual({ status: 403, text: KEY_BODY });
});

test('the gateway masks an email address in the reply', async ({ page }) => {
  await go(page, '/llm/playground');
  let reply = '';
  for (let i = 0; i < 3; i++) {
    reply = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: EMAIL_PROMPT });
    if (reply.includes('<EMAIL_ADDRESS>')) break;
  }
  expect(reply).toContain('<EMAIL_ADDRESS>');
  expect(reply).not.toContain(EMAIL);
  expect(reply).toContain('OK');
  await shot(page, '09-masked-email', page.locator('.chat-message.assistant').last());
});

test('clean up: remove the guards', async ({ page }) => {
  await go(page, '/llm/guardrails');
  const main = page.locator('main');
  // The Remove button next to the page title removes every request and response guard.
  const removeAll = main.getByRole('button', { name: 'Remove', exact: true }).first();
  await shot(page, '10-remove-all', removeAll);
  await removeAll.click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Remove all LLM guardrails?');
  const yes = confirm.getByRole('button', { name: 'Remove guardrails' });
  await shot(page, '11-confirm-remove', yes);
  await yes.click();
  await expect(confirm).toBeHidden();
  await expect(main.getByText('No guards configured.')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Save guardrails' })).toBeHidden();
  await page.waitForTimeout(2000);
  const r = await chatRequest('openai/gpt-6-luna', CARD_PROMPT);
  expect(r.status).toBe(200);
});
