// labs/llm/connect-coding-agents-sso-using-agentdesktop.md
// @fixture base
// @profiles keycloak
import { createHash, randomBytes } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { lab, labSh } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';
import { readConfig } from '../../lib/config';

// agentdesktop runs on the reader's computer, which the test cannot do. The spec signs in to Keycloak the way
// agentdesktop does (authorization code with PKCE, client agentdesktop, callback on 127.0.0.1:51327) and sends
// the token the way Claude Code does (Anthropic Messages API with Authorization: Bearer).
const { go, shot, save } = lab('llm', 'connect-coding-agents-sso-using-agentdesktop');
const ISSUER = 'http://localhost:8180/realms/workshop';
const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;
const CALLBACK = 'http://127.0.0.1:51327/callback';
const DENY_RULE = '"auditors" in jwt.groups';
const ALLOW_RULE = '"platform-team" in jwt.groups';

test.describe.configure({ mode: 'serial' });

let token = '';

test.beforeAll(async () => {
  // Keycloak takes up to a minute to import the realm on first start.
  await expect(async () => {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(r.status).toBe(200);
  }).toPass({ timeout: 180_000, intervals: [2000] });
});

/** Signs a user in through the Keycloak page as agentdesktop does and returns the access token. */
async function signIn(page: Page, user: string, shotLogin?: (btn: Locator) => Promise<void>): Promise<string> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    response_type: 'code', client_id: 'agentdesktop', redirect_uri: CALLBACK,
    scope: 'openid email offline_access', state: 'workshop', code_challenge: challenge, code_challenge_method: 'S256',
  });
  // Nothing listens on the callback port in the test, so read the code from the redirect request itself.
  const callback = page.waitForRequest((r) => r.url().startsWith(CALLBACK), { timeout: 15_000 });
  await page.goto(`${ISSUER}/protocol/openid-connect/auth?${params}`);
  await page.locator('#username').fill(user);
  await page.locator('#password').fill('workshop');
  if (shotLogin) await shotLogin(page.locator('#kc-login'));
  await page.locator('#kc-login').click();
  const code = new URL((await callback).url()).searchParams.get('code') ?? '';
  expect(code).not.toBe('');

  const r = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'agentdesktop', code, redirect_uri: CALLBACK, code_verifier: verifier }),
  });
  const body = await r.json();
  expect(r.status, JSON.stringify(body)).toBe(200);
  expect(body.refresh_token).toBeTruthy();
  return body.access_token;
}

/** Sends one Messages API request with the token, as Claude Code does. */
async function messages(bearer: string): Promise<{ status: number; text: string }> {
  const res = await fetch('http://localhost:4000/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ model: 'openai/gpt-6-luna', max_tokens: 50, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
  });
  return { status: res.status, text: await res.text() };
}

function claims(jwt: string): any {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
}

/** The policy card on LLM Policies, for example 'JWT auth'. */
async function policyCard(page: Page, title: string): Promise<Locator> {
  await go(page, '/llm/policies');
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${title}\\b`) });
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

test('set up', async ({ page }) => {
  await addOpenAIModel(page);
});

test('step 1: require a Keycloak token', async ({ page }) => {
  const card = await policyCard(page, 'JWT auth');
  await shot(page, '01-policies-jwt-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Strict/ }).click();
  await d.getByRole('button', { name: /^Remote URL/ }).click();
  await d.getByRole('textbox', { name: /JWKS URL/ }).fill(JWKS_URL);
  await d.getByRole('textbox', { name: 'Issuer' }).fill(ISSUER);
  await d.getByPlaceholder('api://gateway').fill('agentgateway');
  await d.getByRole('button', { name: 'Add', exact: true }).first().click();
  await d.getByRole('textbox', { name: 'Issuer' }).scrollIntoViewIfNeeded();
  await shot(page, '02-jwt-keycloak', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const jwt = readConfig().llm.policies.jwtAuth;
  expect(jwt.mode).toBe('strict');
  expect(jwt.issuer).toBe(ISSUER);
  expect(jwt.audiences).toEqual(['agentgateway']);
  expect(JSON.stringify(jwt.jwks)).toContain(JWKS_URL);

  await page.waitForTimeout(2000);
  const r = labSh(`curl -si http://localhost:4000/v1/messages \\
  -H 'Content-Type: application/json' \\
  -H 'anthropic-version: 2023-06-01' \\
  -d '{"model":"openai/gpt-6-luna","max_tokens":50,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}'`).stdout;
  expect(r).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
  expect(r.trimEnd().endsWith('authentication failure: no bearer token found')).toBeTruthy();
});

test('step 3: sign in as alice, as agentdesktop does', async ({ page }) => {
  token = await signIn(page, 'alice', (btn) => shot(page, '04-keycloak-sign-in', btn));
  const c = claims(token);
  expect(c.iss).toBe(ISSUER);
  expect(c.aud).toBe('agentgateway');
  expect(c.azp).toBe('agentdesktop');
  expect(c.email).toBe('alice@example.com');
  expect(c.groups).toEqual(['platform-team']);
});

test('step 4: the token reaches the model', async ({ page }) => {
  const r = await messages(token);
  expect(r.status, r.text).toBe(200);
  expect(r.text.toLowerCase()).toContain('ready');

  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: 'gpt-6-luna' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, '07-logs', row);
});

test('step 5: allow only one group', async ({ page }) => {
  const card = await policyCard(page, 'Authorization');
  await shot(page, '08-policies-authz-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Add rule' }).first().click();
  await pasteInto(page, d.locator('.monaco-editor').first(), DENY_RULE, 'auditors');
  await shot(page, '09-authz-auditors', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.authorization).toEqual({ rules: [{ allow: DENY_RULE }] });

  await page.waitForTimeout(2000);
  const denied = await messages(token);
  expect(denied.status).toBe(403);
  expect(denied.text).toContain('authorization failed');

  await (await policyCard(page, 'Authorization')).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), ALLOW_RULE, 'platform-team');
  await shot(page, '10-authz-platform-team', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.authorization).toEqual({ rules: [{ allow: ALLOW_RULE }] });

  await page.waitForTimeout(2000);
  const ok = await messages(token);
  expect(ok.status, ok.text).toBe(200);
});

test('clean up: delete both policies and the model', async ({ page }) => {
  for (const title of ['Authorization', 'JWT auth']) {
    await (await policyCard(page, title)).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
    await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
    await expect(page.locator('aside.drawer')).toBeHidden();
    await page.waitForTimeout(1000);
  }
  const p = readConfig().llm.policies;
  expect(p.jwtAuth).toBeUndefined();
  expect(p.authorization).toBeUndefined();
  await deleteModel(page);
});
