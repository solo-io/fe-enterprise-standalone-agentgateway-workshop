// labs/llm/connect-claude-subscription-sso-using-agentdesktop.md
// @fixture base
// @profiles keycloak
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { HAS_CLAUDE_OAUTH, lab, labSh, sh } from '../../lib/lab';
import { deleteModel } from '../../lib/setup';
import { readConfig } from '../../lib/config';

// agentdesktop runs on the reader's computer and signs in to Claude in a browser, which the test cannot do.
// The spec signs in to Keycloak the way agentdesktop does (authorization code with PKCE, client agentdesktop),
// and stands in for the daemon with a credential command that prints agentdesktop:<claude>:<keycloak> from
// CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) and that token. Claude Code then runs with the settings
// agentdesktop writes. The agentdesktop subscription page screenshot (05) was taken by hand.
const { go, shot, save } = lab('llm', 'connect-claude-subscription-sso-using-agentdesktop');
const NO_TOKEN = 'needs CLAUDE_CODE_OAUTH_TOKEN (claude setup-token) in the shell or setup/.env';
const CLAUDE_CODE = '@anthropic-ai/claude-code@2.1.312';
const ISSUER = 'http://localhost:8180/realms/workshop';
const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;
const CALLBACK = 'http://127.0.0.1:51327/callback';
const LOCATION = 'request.headers["authorization"].split(":")[2]';
const UPSTREAM = '"Bearer " + request.headers["authorization"].split(":")[1]';
const DENY_RULE = '"auditors" in jwt.groups';
const ALLOW_RULE = '"platform-team" in jwt.groups';
const STAND_IN = '/tmp/agentdesktop-stand-in';
// The test container has CLAUDE_CODE_OAUTH_TOKEN set, so every run unsets it as the reader does in Step 6.
const CLAUDE_STEP = `unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
claude -p "Reply with exactly: hello from agentgateway"`;

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => test.skip(!HAS_CLAUDE_OAUTH, NO_TOKEN));

test.beforeAll(async () => {
  if (!HAS_CLAUDE_OAUTH) return;
  // Keycloak takes up to a minute to import the realm on first start.
  await expect(async () => {
    const r = await fetch(`${ISSUER}/.well-known/openid-configuration`);
    expect(r.status).toBe(200);
  }).toPass({ timeout: 180_000, intervals: [2000] });
});

/** Signs a user in through the Keycloak page as agentdesktop does and returns the access token. */
async function signIn(page: Page, user: string): Promise<string> {
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
  return body.access_token;
}

/** Signs alice in and gives the stand-in credential command her fresh token. Keycloak tokens last five minutes. */
async function signInAlice(page: Page): Promise<string> {
  const jwt = await signIn(page, 'alice');
  writeFileSync(`${STAND_IN}/jwt`, jwt);
  return `agentdesktop:${process.env.CLAUDE_CODE_OAUTH_TOKEN}:${jwt}`;
}

/** Sends one Messages API request with the credential, as Claude Code does. */
async function messages(credential: string): Promise<{ status: number; text: string }> {
  const res = await fetch('http://localhost:4000/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${credential}` },
    body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 50, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] }),
  });
  return { status: res.status, text: await res.text() };
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

test('step 1: add a Claude model with no provider key', async ({ page }) => {
  await go(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Anthropic', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill('claude-*');
  await expect(d.getByRole('button', { name: /^Provider API key/ })).toContainText('Unset');
  await d.getByRole('button', { name: 'Incoming model', exact: true }).click();
  await shot(page, '01-add-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
  expect(readConfig().llm.models).toEqual([{ name: 'claude-*', provider: 'anthropic', params: {} }]);
});

test('step 2: require a Keycloak token from the third part', async ({ page }) => {
  await (await policyCard(page, 'JWT auth')).click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Strict/ }).click();
  await d.getByRole('button', { name: /^Remote URL/ }).click();
  await d.getByRole('textbox', { name: /JWKS URL/ }).fill(JWKS_URL);
  await d.getByRole('textbox', { name: 'Issuer' }).fill(ISSUER);
  await d.getByPlaceholder('api://gateway').fill('agentgateway');
  await d.getByRole('button', { name: 'Add', exact: true }).first().click();
  await d.getByRole('button', { name: 'Customize' }).click();
  await d.getByRole('combobox', { name: 'Location type' }).click();
  await page.getByRole('option', { name: 'CEL expression' }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), LOCATION, 'split');
  await shot(page, '02-jwt-location', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const jwt = readConfig().llm.policies.jwtAuth;
  expect(jwt.mode).toBe('strict');
  expect(jwt.issuer).toBe(ISSUER);
  expect(jwt.audiences).toEqual(['agentgateway']);
  expect(JSON.stringify(jwt.jwks)).toContain(JWKS_URL);
  expect(jwt.location).toEqual({ expression: LOCATION });

  await page.waitForTimeout(2000);
  const r = labSh(`curl -si http://localhost:4000/v1/messages \\
  -H 'Content-Type: application/json' \\
  -H 'anthropic-version: 2023-06-01' \\
  -d '{"model":"claude-haiku-5-5","max_tokens":50,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}'`).stdout;
  expect(r).toMatch(/^HTTP\/1\.1 401 Unauthorized/);
  expect(r.trimEnd().endsWith('authentication failure: no bearer token found')).toBeTruthy();
});

test('step 3: send only the Claude token to Anthropic', async ({ page }) => {
  const card = await policyCard(page, 'Transformations');
  await shot(page, '03-policies-transformations-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Request transformations/ }).click();
  await d.getByRole('textbox', { name: 'header name' }).nth(1).fill('authorization');
  await d.getByRole('textbox', { name: 'CEL expression' }).nth(1).fill(UPSTREAM);
  await d.getByRole('button', { name: 'Add', exact: true }).nth(1).click();
  await expect(d.getByRole('button', { name: 'Remove' })).toHaveCount(1);
  await shot(page, '04-transformations', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.transformations).toEqual({ request: { set: { authorization: UPSTREAM } }, response: {} });
});

test('step 6: Claude Code runs on the subscription through the gateway', async ({ page }) => {
  test.setTimeout(300_000);
  const install = sh(`npm install -g --no-audit --no-fund --loglevel=error ${CLAUDE_CODE}`);
  expect(install.code, install.stdout).toBe(0);

  // What agentdesktop does in Steps 4 and 5: a credential command and the settings that use it.
  mkdirSync(STAND_IN, { recursive: true });
  writeFileSync(`${STAND_IN}/claude`, process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '');
  writeFileSync(`${STAND_IN}/credential.sh`, `#!/bin/sh\nprintf 'agentdesktop:%s:%s' "$(cat ${STAND_IN}/claude)" "$(cat ${STAND_IN}/jwt)"\n`, { mode: 0o755 });
  mkdirSync(`${homedir()}/.claude`, { recursive: true });
  writeFileSync(`${homedir()}/.claude/settings.json`, JSON.stringify({
    apiKeyHelper: `${STAND_IN}/credential.sh`,
    env: { ANTHROPIC_BASE_URL: 'http://localhost:4000/', CLAUDE_CODE_API_KEY_HELPER_TTL_MS: '60000' },
  }));
  await signInAlice(page);

  const r = labSh(CLAUDE_STEP);
  expect(r.code, r.stdout).toBe(0);
  expect(r.stdout).toContain('hello from agentgateway');

  await go(page, '/llm/logs');
  const row = page.locator('main tbody tr').filter({ hasText: /claude-/ }).filter({ hasText: '200' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-logs', row);
});

test('step 7: allow only one group', async ({ page }) => {
  test.setTimeout(300_000);
  const d = page.getByRole('dialog');
  await (await policyCard(page, 'Authorization')).click();
  await d.getByRole('button', { name: 'Add rule' }).first().click();
  await pasteInto(page, d.locator('.monaco-editor').first(), DENY_RULE, 'auditors');
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.authorization).toEqual({ rules: [{ allow: DENY_RULE }] });

  await page.waitForTimeout(2000);
  const denied = await messages(await signInAlice(page));
  expect(denied.status).toBe(403);
  expect(denied.text).toContain('authorization failed');

  await (await policyCard(page, 'Authorization')).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), ALLOW_RULE, 'platform-team');
  await save(page, 'Save policy');
  expect(readConfig().llm.policies.authorization).toEqual({ rules: [{ allow: ALLOW_RULE }] });

  await page.waitForTimeout(2000);
  await signInAlice(page);
  const r = labSh(CLAUDE_STEP);
  expect(r.code, r.stdout).toBe(0);
  expect(r.stdout).toContain('hello from agentgateway');
});

test('clean up: delete the policies and the model', async ({ page }) => {
  for (const title of ['Authorization', 'Transformations', 'JWT auth']) {
    await (await policyCard(page, title)).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
    await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
    await expect(page.locator('aside.drawer')).toBeHidden();
    await page.waitForTimeout(1000);
  }
  const p = readConfig().llm.policies ?? {};
  expect(p.jwtAuth).toBeUndefined();
  expect(p.transformations).toBeUndefined();
  expect(p.authorization).toBeUndefined();
  await deleteModel(page, 'claude-*');
  sh(`rm -rf ${STAND_IN} ${homedir()}/.claude/settings.json`);
});
