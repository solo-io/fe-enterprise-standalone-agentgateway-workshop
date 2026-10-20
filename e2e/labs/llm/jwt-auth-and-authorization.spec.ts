// labs/llm/jwt-auth-and-authorization.md
// @fixture llm-ready
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { chat, lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

const { go, shot, save } = lab('llm', 'jwt-auth-and-authorization');

const JWKS = readFileSync('/repo/lib/jwt/public-jwks.json', 'utf8').trim();
const ALICE = readFileSync('/repo/lib/jwt/tokens/alice.jwt', 'utf8').trim();
const BOB = readFileSync('/repo/lib/jwt/tokens/bob.jwt', 'utf8').trim();
const MODEL = { model: 'openai/*', specific: 'gpt-6-luna' };
const PROMPT = 'Reply with the single word: pong';
const RULE = 'jwt.team == "platform"';

test.describe.configure({ mode: 'serial' });

/** Runs the lab's curl from the repo root, optionally with a token file. Returns the full response with headers. */
function curl(tokenFile?: string): string {
  const auth = tokenFile ? `-H "Authorization: Bearer $(cat lib/jwt/tokens/${tokenFile})" ` : '';
  return sh(`cd /repo && curl -si http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  ${auth}-d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Reply with the single word: pong"}]}'`).stdout;
}

/** Replaces the text of a code editor field the way a reader does: select all, then paste. */
async function pasteInto(page: Page, editor: Locator, text: string, marker: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(async () => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
    await editor.locator('.view-lines').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(editor).toContainText(marker, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

/** Sends one prompt from the Chat Playground (already open) and returns the error banner it shows. */
async function chatError(page: Page, apiKey: string): Promise<Locator> {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: MODEL.model }).first().click();
  await main.getByPlaceholder('Select or type a model').fill(MODEL.specific);
  await main.getByPlaceholder('Optional Bearer token').fill(apiKey);
  await main.getByPlaceholder('Ask a test question...').fill(PROMPT);
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed').locator('..');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  return banner;
}

/** The policy card on LLM Policies, for example 'JWT auth'. */
async function policyCard(page: Page, title: string): Promise<Locator> {
  await go(page, '/llm/policies');
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${title}\\b`) });
}

test('add a JWT auth policy', async ({ page }) => {
  const card = await policyCard(page, 'JWT auth');
  await shot(page, '01-policies-jwt-card', card);
  await card.click();

  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Strict/ }).click();
  await d.getByRole('button', { name: /^Inline JSON/ }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), JWKS, 'workshop-1');
  await shot(page, '02-jwt-signing-keys', d.getByRole('button', { name: /^Inline JSON/ }));

  await d.getByRole('textbox', { name: 'Issuer' }).fill('solo-workshop');
  await d.getByPlaceholder('api://gateway').fill('agentgateway');
  await d.getByRole('button', { name: 'Add', exact: true }).first().click();
  await d.getByRole('textbox', { name: 'Issuer' }).scrollIntoViewIfNeeded();
  await shot(page, '03-jwt-token-validation', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const jwt = readConfig().llm.policies.jwtAuth;
  expect(jwt.mode).toBe('strict');
  expect(jwt.issuer).toBe('solo-workshop');
  expect(jwt.audiences).toEqual(['agentgateway']);
  expect(jwt.jwks).toContain('workshop-1');
});

test('no token gets 401, alice gets 200', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const denied = await chatError(page, '');
  await expect(denied).toContainText('authentication failure: no bearer token found');
  await shot(page, '04-playground-no-token', page.locator('main').getByPlaceholder('Optional Bearer token'));
  const r = curl();
  expect(r).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
  expect(r.trimEnd().endsWith('authentication failure: no bearer token found')).toBeTruthy();

  const ok = await chat(page, { ...MODEL, apiKey: ALICE, prompt: PROMPT });
  expect(ok).toContain('OK');
  await shot(page, '05-playground-alice', page.locator('.chat-message.assistant').last());
});

test('add an authorization rule for team platform', async ({ page }) => {
  const card = await policyCard(page, 'Authorization');
  await shot(page, '06-policies-authz-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Add rule' }).first().click();
  await expect(d.getByRole('combobox', { name: 'Rule 1 effect' })).toHaveText('Allow');
  await pasteInto(page, d.locator('.monaco-editor').first(), RULE, 'platform');
  await shot(page, '07-authz-rule', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.authorization).toEqual({ rules: [{ allow: RULE }] });
});

test('optional: try the rule in the CEL Playground', async ({ page }) => {
  await go(page, '/cel');
  const main = page.locator('main');
  const editors = main.locator('.monaco-editor');
  const result = main.getByText('YAML value returned by CEL evaluation.').locator('../..');
  await pasteInto(page, editors.nth(0), RULE, 'platform');
  for (const [team, want] of [['marketing', 'false'], ['platform', 'true']]) {
    await pasteInto(page, editors.nth(1), `jwt:\n  sub: alice\n  team: ${team}\n`, `team: ${team}`);
    await main.getByRole('button', { name: 'Evaluate' }).click();
    await expect(result).toContainText(new RegExp(`\\b${want}\\b`));
  }
  await shot(page, '08-cel-playground', result);
});

test('bob gets 403, alice gets 200', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const denied = await chatError(page, BOB);
  await expect(denied).toContainText('authorization failed');
  await shot(page, '09-playground-bob', denied);
  const r = curl('bob.jwt');
  expect(r).toMatch(/^HTTP\/1\.1 403 Forbidden/);
  expect(r.trimEnd().endsWith('authorization failed')).toBeTruthy();

  const ok = await chat(page, { ...MODEL, apiKey: ALICE, prompt: PROMPT });
  expect(ok).toContain('OK');
  await shot(page, '10-playground-alice-allowed', page.locator('.chat-message.assistant').last());
});

test('clean up: delete both policies', async ({ page }) => {
  for (const title of ['Authorization', 'JWT auth']) {
    const card = await policyCard(page, title);
    await card.click();
    const del = page.getByRole('dialog').getByRole('button', { name: 'Delete policy' });
    if (title === 'Authorization') await shot(page, '11-delete-policy', del);
    await del.click();
    const confirm = page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' });
    if (title === 'Authorization') await shot(page, '12-confirm-delete', confirm);
    await confirm.click();
    await expect(page.locator('aside.drawer')).toBeHidden();
    await page.waitForTimeout(1000);
    await expect(card).toContainText('disabled');
  }
  const p = readConfig().llm.policies;
  expect(p.jwtAuth).toBeUndefined();
  expect(p.authorization).toBeUndefined();
});
