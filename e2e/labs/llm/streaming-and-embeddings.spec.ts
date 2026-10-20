// labs/llm/streaming-and-embeddings.md
// @fixture llm-ready
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { lab, sh } from '../../lib/lab';

const { go, shot } = lab('llm', 'streaming-and-embeddings');

test.describe.configure({ mode: 'serial' });

test('stream a reply', async () => {
  const r = sh(`curl -sN http://localhost:4000/v1/chat/completions \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"openai/gpt-6-luna","stream":true,"messages":[{"role":"user","content":"Count from 1 to 5, one number per line."}]}'`);
  writeFileSync('/repo/e2e/.last/streaming-and-embeddings-stream.txt', r.stdout);
  const events = r.stdout.split('\n').filter((l) => l.startsWith('data: '));
  expect(events.at(-1)).toBe('data: [DONE]');
  const chunks = events.slice(0, -1).map((l) => JSON.parse(l.slice(6)));
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true);
  // The request has no stream_options; the gateway asks OpenAI for usage on its own.
  const last = chunks.at(-1);
  expect(last.choices).toEqual([]);
  expect(last.usage.prompt_tokens).toBeGreaterThan(0);
  expect(last.usage.completion_tokens).toBeGreaterThan(0);
});

test('create an embedding', async () => {
  const r = sh(`curl -s http://localhost:4000/v1/embeddings \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"openai/text-embedding-3-small","input":"The gateway counts every request."}'`);
  writeFileSync('/repo/e2e/.last/streaming-and-embeddings-embedding.json', r.stdout);
  const body = JSON.parse(r.stdout);
  expect(body.object).toBe('list');
  expect(body.model).toMatch(/^text-embedding-3-small/);
  expect(body.data[0].object).toBe('embedding');
  expect(body.data[0].embedding).toHaveLength(1536);
  expect(body.usage.prompt_tokens).toBeGreaterThan(0);
});

test('see both requests in Logs', async ({ page }) => {
  await go(page, '/llm/logs');
  const main = page.locator('main');
  const chatRow = main.locator('tbody').filter({ hasText: 'openai/gpt-6-luna' }).first();
  const embRow = main.locator('tbody').filter({ hasText: 'openai/text-embedding-3-small' }).first();
  await expect(chatRow).toBeVisible({ timeout: 30_000 });
  await expect(embRow).toBeVisible();
  await expect(chatRow).toContainText('200');
  await expect(chatRow).toContainText('$');
  await expect(embRow).toContainText('200');
  await expect(embRow).toContainText(/embeddings/i);
  await expect(embRow).toContainText('$');
  await shot(page, '01-logs', embRow);

  await embRow.locator('tr').first().click();
  await expect(embRow).toContainText(/operation/i);
  writeFileSync('/repo/e2e/.last/streaming-and-embeddings-logs.txt', await main.innerText());
  await shot(page, '02-embedding-details');
});
