// labs/llm/prompt-enrichment-and-transformations.md
// @fixture llm-ready
import { expect, test, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('llm', 'prompt-enrichment-and-transformations');

test.describe.configure({ mode: 'serial' });

const SYSTEM = '[{"role": "system", "content": "Always end your reply with the word BANANA."}] + llmRequest.messages';
const HEADERS: [string, string][] = [
  ['x-user-id', 'default(request.headers["x-user-id"], "anonymous")'],
  ['x-llm-response-model', 'json(response.body).model'],
  ['x-request-path', 'request.path'],
];

const CURL = `curl -s -i http://localhost:4000/v1/chat/completions \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"openai/gpt-6-luna","messages":[{"role":"user","content":"Name one color."}]}'`;

/** Opens the openai/* model's Edit model panel with Advanced > Model policies > Transformation expanded. */
async function openModelTransformation(page: Page) {
  await go(page, '/llm/models');
  const edit = page.getByRole('button', { name: 'Edit model' }).first();
  await edit.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Advanced/ }).click();
  await d.getByRole('button', { name: /^Model policies/ }).click();
  await expect(d.getByPlaceholder('field name')).toBeVisible();
  return d;
}

test('add response headers with a Transformations policy', async ({ page }) => {
  await go(page, '/llm/policies');
  const card = page.locator('main').getByRole('button', { name: /Transformations/ });
  await shot(page, '01-policies-transformations', card);
  await card.click();

  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Response transformations/ }).click();
  // Response section: header name inputs are Add, Set, Remove; CEL inputs are Add, Set, Metadata.
  const name = d.getByPlaceholder('header name').nth(1);
  const expr = d.getByPlaceholder('CEL expression').nth(1);
  const add = d.getByRole('button', { name: 'Add', exact: true }).nth(1);
  for (const [n, e] of HEADERS) {
    await name.fill(n);
    await expr.fill(e);
    await add.click();
  }
  for (const [n] of HEADERS) await expect(d).toContainText(n);
  await d.getByText('Set headers', { exact: true }).scrollIntoViewIfNeeded();
  await shot(page, '02-set-headers', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');

  const set = readConfig().llm.policies.transformations.response.set;
  expect(set['x-request-path']).toBe('request.path');
});

test('the response carries the new headers', async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const r = sh(CURL);
  expect(r.stdout).toMatch(/^HTTP\/1\.1 200/);
  expect(r.stdout).toMatch(/^x-user-id: anonymous$/m);
  expect(r.stdout).toMatch(/^x-llm-response-model: gpt-6-luna\r?$/m);
  expect(r.stdout).toMatch(/^x-request-path: \/v1\/chat\/completions$/m);
});

test('prepend a system prompt on the openai/* model', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '03-edit-model', page.getByRole('button', { name: 'Edit model' }).first());
  const d = await openModelTransformation(page);
  await d.getByPlaceholder('field name').fill('messages');
  await d.getByPlaceholder('CEL expression').fill(SYSTEM);
  await d.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(d).toContainText('Always end your reply with the word BANANA.');
  await d.getByText('LLM request fields').scrollIntoViewIfNeeded();
  await shot(page, '04-model-transformation', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');

  const m = readConfig().llm.models.find((x: any) => x.name === 'openai/*');
  expect(m.transformation.messages).toBe(SYSTEM);
  expect(m.transformation.model).toBe('llmRequest.model.stripPrefix("openai/")');
});

test('the Chat Playground reply contains BANANA', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  // The user prompt does not contain BANANA; only the injected system prompt asks for it.
  // The lab says "contains BANANA, usually at the end. If it does not, click Send again"; up to 3 sends.
  let reply = '';
  for (let i = 0; i < 3; i++) {
    reply = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: 'Name one color.' });
    if (/BANANA/.test(reply)) break;
  }
  expect(reply).toMatch(/BANANA/);
  // The status chip, not the reply text, so a model reply that says "OK" cannot pass.
  await expect(page.locator('.chat-message.assistant').last().locator('.message-meta-chip', { hasText: /^OK$/ })).toHaveCount(1);
  await shot(page, '05-playground-banana', page.locator('.chat-message.assistant').last());
});

test('clean up: remove the system prompt and the policy', async ({ page }) => {
  const d = await openModelTransformation(page);
  // Rows: model (row 1), messages (row 2).
  const remove = d.getByRole('button', { name: 'Remove', exact: true }).nth(1);
  await shot(page, '06-remove-messages', remove);
  await remove.click();
  await expect(d).not.toContainText('Always end your reply');
  await save(page, 'Save model');

  await go(page, '/llm/policies');
  await page.locator('main').getByRole('button', { name: /Transformations/ }).click();
  const del = page.getByRole('dialog').getByRole('button', { name: 'Delete policy' });
  await shot(page, '07-delete-policy', del);
  await del.click();
  // The UI asks to confirm: "Delete the Transformations policy from this configuration?"
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.waitForTimeout(1000);

  const cfg = readConfig();
  expect(cfg.llm.policies.transformations).toBeUndefined();
  expect(cfg.llm.models[0].transformation.messages).toBeUndefined();
});
