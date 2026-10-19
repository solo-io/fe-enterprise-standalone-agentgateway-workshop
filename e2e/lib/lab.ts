import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';

export const UI = 'http://localhost:15000/ui';
const UPDATE = process.env.UPDATE_SCREENSHOTS === '1';
export const HAS_ANTHROPIC = process.env.HAS_ANTHROPIC === '1';
export const HAS_AWS = process.env.HAS_AWS === '1';
export const HAS_BEDROCK_KEY = process.env.HAS_BEDROCK_KEY === '1';

/** Navigation and screenshot helpers bound to one lab's image folder. */
export function lab(track: string, slug: string) {
  const dir = `/repo/images/${track}/${slug}`;

  return {
    /** Opens a UI page, for example go(page, '/llm/models'), and waits for it to finish loading. */
    async go(page: Page, path: string): Promise<void> {
      await page.goto(UI + path);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Loading permissions');
    },

    /**
     * Saves images/<track>/<slug>/<name>.png when UPDATE_SCREENSHOTS=1.
     * `target` gets a red outline in the image to show where to click.
     */
    async shot(page: Page, name: string, target?: Locator): Promise<void> {
      if (!UPDATE) return;
      mkdirSync(dir, { recursive: true });
      if (target) {
        await target.scrollIntoViewIfNeeded();
        await target.evaluate((el: HTMLElement) => {
          el.dataset.agwOutline = el.style.outline;
          el.style.outline = '3px solid #e11d48';
          el.style.outlineOffset = '2px';
        });
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${name}.png` });
      if (target) {
        await target.evaluate((el: HTMLElement) => {
          el.style.outline = el.dataset.agwOutline ?? '';
          el.style.outlineOffset = '';
        });
      }
    },

    /** Clicks a save-type button and waits for the save to land. */
    async save(page: Page, button: string | Locator): Promise<void> {
      const btn = typeof button === 'string' ? page.getByRole('button', { name: button, exact: true }).last() : button;
      await btn.click();
      await Promise.race([
        page.getByText('Configuration saved').first().waitFor({ timeout: 10_000 }),
        btn.waitFor({ state: 'detached', timeout: 10_000 }),
      ]).catch(() => {});
      await page.waitForTimeout(1000);
    },
  };
}

/** Runs a bash command (used to run a lab's exact curl). */
export function sh(cmd: string): { code: number; stdout: string } {
  const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', timeout: 120_000 });
  return { code: r.status ?? -1, stdout: (r.stdout ?? '') + (r.stderr ?? '') };
}

/**
 * Stops or starts a Compose helper of this run, as `docker compose stop|start <service>` does.
 * Needs `// @docker yes` in the spec header, which mounts the Docker socket.
 */
export function helper(action: 'stop' | 'start', service: string): void {
  const name = `${process.env.COMPOSE_PROJECT}-${service}-1`;
  const r = sh(`curl -s -o /dev/null -w '%{http_code}' --unix-socket /var/run/docker.sock -X POST http://localhost/containers/${name}/${action}`);
  if (!['204', '304'].includes(r.stdout.trim())) throw new Error(`docker ${action} ${name}: HTTP ${r.stdout}`);
}

/** Returns the last log lines of a Compose service of this run. Needs `// @docker yes`. */
export function helperLogs(service: string, tail = 500): string {
  const name = `${process.env.COMPOSE_PROJECT}-${service}-1`;
  return sh(`curl -s --unix-socket /var/run/docker.sock 'http://localhost/containers/${name}/logs?stdout=1&stderr=1&tail=${tail}'`).stdout;
}

/** Sends an OpenAI-format chat request to the gateway and returns status and body text. */
export async function chatRequest(
  model: string,
  prompt: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const res = await fetch('http://localhost:4000/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * Fills the Chat Playground (already open) and sends one prompt.
 * Returns the text of the new assistant message, which holds the reply or the error the gateway returned.
 * `model` is the Model dropdown entry (for example 'openai/*'); `specific` fills Specific model for wildcards.
 */
export async function chat(
  page: Page,
  opts: { model: string; specific?: string; prompt: string; apiKey?: string },
): Promise<string> {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Model' }).click();
  await page.getByRole('option', { name: opts.model, exact: false }).first().click();
  if (opts.specific) await main.getByPlaceholder('Select or type a model').fill(opts.specific);
  if (opts.apiKey !== undefined) await main.getByPlaceholder('Optional Bearer token').fill(opts.apiKey);
  await main.getByPlaceholder('Ask a test question...').fill(opts.prompt);
  const replies = main.locator('.chat-message.assistant');
  const before = await replies.count();
  await main.getByRole('button', { name: 'Send' }).click();
  await expect(replies).toHaveCount(before + 1, { timeout: 90_000 });
  const reply = replies.nth(before);
  await expect(reply.locator('.message-meta-chip').first()).toBeVisible({ timeout: 90_000 });
  return reply.innerText();
}
