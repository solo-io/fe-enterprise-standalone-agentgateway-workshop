// labs/llm/semantic-routing-jev.md
// @fixture base
// @profiles semantic-router-jev
// @docker yes
import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import { readConfig } from '../../lib/config';
import { chat, helper, helperLogs, lab, sh } from '../../lib/lab';
import { addOpenAIModel, deleteModel } from '../../lib/setup';

const { go, shot, save } = lab('llm', 'semantic-routing-jev');

test.describe.configure({ mode: 'serial' });

const SERVICE = 'semantic-router-jev';
const KEY_VAR = 'TYPESAFE_AI_API_KEY';
const HOST = `${SERVICE}:50051`;
const NO_KEY = `needs ${KEY_VAR} in the shell or setup/.env`;
// Prompts from the Kubernetes lab, and the tier model each one reaches (setup/semantic-router-jev/profile.json).
const PROMPTS = [
  { text: 'Summarize this email in one sentence: lunch moved to noon.', model: 'openai/gpt-5-nano', tier: 'economy', reason: 'classified' },
  { text: 'Write a Python function that parses a CSV file and returns the sum of each numeric column.', model: 'openai/gpt-5.6-luna', tier: 'mid', reason: 'classified' },
  { text: 'Show that there are infinitely many primes.', model: 'openai/gpt-5.6-terra', tier: 'high', reason: 'classified' },
  { text: 'Explain what this regex does: ^\\d{3}-\\d{4}$', model: 'openai/gpt-5.6-luna', tier: 'mid', reason: 'low_confidence' },
];
const PONG = 'Reply with the single word: pong';

// ---- Docker Engine API, through the socket that `// @docker yes` mounts.

function docker(method: string, path: string, body?: unknown): string {
  let data = '';
  if (body !== undefined) {
    writeFileSync('/tmp/docker-body.json', JSON.stringify(body));
    data = `-H 'content-type: application/json' -d @/tmp/docker-body.json`;
  }
  return sh(`curl -s --unix-socket /var/run/docker.sock -X ${method} ${data} 'http://localhost${path}'`).stdout;
}

const container = () => `${process.env.COMPOSE_PROJECT}-${SERVICE}-1`;

function containerEnv(name: string): string {
  const info = JSON.parse(docker('GET', `/containers/${container()}/json`));
  const line = (info.Config.Env as string[]).find((e) => e.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1) : '';
}

/**
 * Recreates the helper with one environment value changed, as
 * `KEY=value docker compose --profile <p> up -d <service>` does.
 */
function recreateWith(name: string, value: string): void {
  const info = JSON.parse(docker('GET', `/containers/${container()}/json`));
  const Env = (info.Config.Env as string[]).map((e) => (e.startsWith(`${name}=`) ? `${name}=${value}` : e));
  const EndpointsConfig = Object.fromEntries(
    Object.entries(info.NetworkSettings.Networks).map(([net, v]: [string, any]) => [net, { Aliases: v.Aliases ?? [SERVICE] }]),
  );
  docker('POST', `/containers/${container()}/stop`);
  docker('DELETE', `/containers/${container()}`);
  const created = JSON.parse(docker('POST', `/containers/create?name=${container()}`, {
    ...info.Config, Env, HostConfig: info.HostConfig, NetworkingConfig: { EndpointsConfig },
  }));
  if (!created.Id) throw new Error(`create ${container()}: ${JSON.stringify(created)}`);
  helper('start', SERVICE);
}

const startedCount = (): number => (helperLogs(SERVICE, 200).match(/"event": "started"/g) ?? []).length;

/** Waits until the helper has logged more than `before` started lines (pip install runs first on a new container). */
async function waitStarted(page: Page, before = 0): Promise<void> {
  await expect.poll(startedCount, { timeout: 180_000, intervals: [2000] }).toBeGreaterThan(before);
  await page.waitForTimeout(1000);
}

const HAS_KEY = (() => { try { return containerEnv(KEY_VAR) !== ''; } catch { return false; } })();

// ---- UI helpers

async function pick(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('dialog').getByRole('combobox', { name: label }).click();
  await page.getByRole('option').filter({ has: page.getByText(option, { exact: true }) }).first().click();
}

async function policyCard(page: Page): Promise<Locator> {
  await go(page, '/llm/policies');
  return page.locator('main').getByRole('button', { name: /^(enabled|disabled)\s*External processor\b/ });
}

/** Sends one prompt to auto_model from a fresh Chat Playground. Returns the banner text on failure, or the reply. */
async function sendOnce(page: Page, prompt: string): Promise<{ failed: boolean; text: string }> {
  await go(page, '/llm/playground');
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: 'auto_model' }).first().click();
  await main.getByPlaceholder('Ask a test question...').fill(prompt);
  await main.getByRole('button', { name: 'Send' }).click();
  const banner = main.getByText('Playground request failed', { exact: true });
  const reply = main.locator('.chat-message.assistant').first();
  await expect(banner.or(reply.locator('.message-meta-chip').first())).toBeVisible({ timeout: 90_000 });
  if (await banner.isVisible()) return { failed: true, text: await banner.locator('..').innerText() };
  return { failed: false, text: await reply.innerText() };
}

/** The models of the newest OpenAI rows on the Logs page, newest first. */
async function loggedModels(page: Page, n: number): Promise<string[]> {
  await go(page, '/llm/logs');
  const rows = page.locator('main tbody tr').filter({ hasText: 'OpenAI' });
  await expect.poll(() => rows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(n);
  const texts = await rows.allInnerTexts();
  return texts.slice(0, n).map((t) => (t.match(/openai\/[\w.*-]+|auto_model/) ?? [''])[0]);
}

function decisions(): any[] {
  return helperLogs(SERVICE).split('\n')
    .map((l) => l.slice(l.indexOf('{')))
    .filter((l) => l.includes('"routing_decision"'))
    .map((l) => JSON.parse(l));
}

test('set up', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  await addOpenAIModel(page);
});

test('the adapter is running', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  await waitStarted(page);
  expect(helperLogs(SERVICE)).toContain('"tiers": {"economy": "openai/gpt-5-nano", "mid": "openai/gpt-5.6-luna", "high": "openai/gpt-5.6-terra"}');
});

test('step 1: add the auto_model virtual model', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  await go(page, '/llm/models');
  const add = page.getByRole('button', { name: 'Add virtual model', exact: true });
  await shot(page, '01-models', add);
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('resilient').fill('auto_model');
  await expect(d.getByRole('button', { name: 'Weighted', exact: true })).toBeVisible();
  await expect(d.getByRole('combobox', { name: 'Model' })).toHaveText(/openai\/\*/);
  await d.getByRole('textbox', { name: 'Specific model' }).fill('gpt-5.6-luna');
  await d.getByText('Virtual model name').click();
  await shot(page, '02-add-virtual-model', d.getByRole('button', { name: 'Save virtual model' }));
  await save(page, 'Save virtual model');
  expect(readConfig().llm.virtualModels).toEqual([
    { name: 'auto_model', routing: { weighted: { targets: [{ model: 'openai/gpt-5.6-luna', weight: 1 }] } } },
  ]);
});

test('step 2: add the External processor policy', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  const card = await policyCard(page);
  await shot(page, '03-policies-extproc-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('host:port or unix:/path/to/socket').fill(HOST);
  await pick(page, 'Failure mode', 'Fail open');
  await pick(page, 'Request body', 'Buffered');
  await pick(page, 'Response body', 'None');
  await pick(page, 'Response headers', 'Skip');
  await pick(page, 'Request trailers', 'Skip');
  await pick(page, 'Response trailers', 'Skip');
  await expect(d.getByRole('combobox', { name: 'Request headers' })).toHaveText('Send');
  await d.getByRole('combobox', { name: 'Request headers' }).scrollIntoViewIfNeeded();
  await shot(page, '04-extproc-form', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const p = readConfig().llm.policies.extProc;
  expect(p).toMatchObject({
    host: HOST,
    failureMode: 'failOpen',
    processingOptions: {
      requestBodyMode: 'buffered', responseBodyMode: 'none', requestHeaderMode: 'send',
      responseHeaderMode: 'skip', requestTrailerMode: 'skip', responseTrailerMode: 'skip',
    },
  });
});

test('step 3: send four prompts to auto_model', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  test.setTimeout(240_000);
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  for (const p of PROMPTS) {
    const reply = await chat(page, { model: 'auto_model', prompt: p.text });
    expect(reply).toContain('OK');
  }
  const main = page.locator('main');
  await expect(main.locator('.chat-message.assistant')).toHaveCount(PROMPTS.length);
  await shot(page, '05-playground', main.getByRole('button', { name: 'Send' }));
});

test('check it: Logs show the model that served each prompt', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  const models = await loggedModels(page, PROMPTS.length);
  expect(models).toEqual(PROMPTS.map((p) => p.model).reverse());
  await shot(page, '06-logs');

  const d = decisions();
  console.log(helperLogs(SERVICE).split('\n').filter((l) => l.includes('routing_decision')).join('\n'));
  expect(d.map((x) => [x.original_model, x.selected_model, x.tier, x.reason]))
    .toEqual(PROMPTS.map((p) => ['auto_model', p.model, p.tier, p.reason]));
});

const model = (body: string): string => JSON.parse(body).model;

test('optional curl: auto_model and a named model', () => {
  test.skip(!HAS_KEY, NO_KEY);
  // The lab pipes to `jq -r '.model'`; the test image has no jq, so the test parses the JSON itself.
  const auto = model(sh(`curl -s http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"auto_model","messages":[{"role":"user","content":"Summarize this email in one sentence: lunch moved to noon."}]}'`).stdout);
  expect(auto).toMatch(/^gpt-5-nano-\d{4}-\d{2}-\d{2}$/);
  const named = model(sh(`curl -s http://localhost:4000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai/gpt-5-nano","messages":[{"role":"user","content":"Prove that sqrt(2) is irrational."}]}'`).stdout);
  expect(named).toMatch(/^gpt-5-nano-\d{4}-\d{2}-\d{2}$/);
  // The named model passed through the adapter without a Jev call.
  expect(decisions().length).toBe(PROMPTS.length + 1);
});

test('step 4: the adapter is down, auto_model falls back', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  helper('stop', SERVICE);
  const r = await sendOnce(page, PONG);
  expect(r.failed).toBe(false);
  expect(r.text).toContain('OK');
  await shot(page, '07-adapter-down-reply', page.locator('.chat-message.assistant').last());
  const [model] = await loggedModels(page, 1);
  expect(model).toBe('auto_model');
  const row = page.locator('main tbody tr').filter({ hasText: 'OpenAI' }).first();
  await expect(row).toContainText('gpt-5.6-luna');
  console.log('fallback row:', (await row.innerText()).replace(/\s+/g, ' '));
  await shot(page, '08-logs-fallback');
  const before = startedCount();
  helper('start', SERVICE);
  await waitStarted(page, before);
});

test('step 5: Jev rejects the key, the adapter answers 503', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  test.setTimeout(300_000);
  const good = containerEnv(KEY_VAR);
  recreateWith(KEY_VAR, 'invalid');
  try {
    await waitStarted(page);
    const r = await sendOnce(page, PONG);
    expect(r.failed).toBe(true);
    expect(r.text).toContain('routing classifier unavailable');
    await shot(page, '09-classifier-unavailable', page.locator('main').getByText('Playground request failed', { exact: true }).locator('..'));
    const err = helperLogs(SERVICE, 5);
    console.log(err);
    expect(err).toContain('"event": "jev_error"');
    expect(err).toContain('401');
  } finally {
    recreateWith(KEY_VAR, good);
  }
  await waitStarted(page);
});

test('clean up', async ({ page }) => {
  test.skip(!HAS_KEY, NO_KEY);
  const card = await policyCard(page);
  await card.click();
  const del = page.getByRole('dialog').getByRole('button', { name: 'Delete policy' });
  await shot(page, '10-delete-policy', del);
  await del.click();
  await page.getByText('Delete policy?').locator('../..').getByRole('button', { name: 'Delete policy' }).click();
  await expect(page.locator('aside.drawer')).toBeHidden();
  await page.waitForTimeout(1000);
  await expect(card).toContainText('disabled');
  expect(readConfig().llm.policies.extProc).toBeUndefined();

  await go(page, '/llm/models');
  const main = page.locator('main');
  const row = main.getByRole('row').filter({ has: page.getByText('auto_model', { exact: true }) });
  await row.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete (virtual )?model$/ }).click();
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(readConfig().llm.virtualModels ?? []).toEqual([]);
  helper('stop', SERVICE);
  await deleteModel(page);
});
