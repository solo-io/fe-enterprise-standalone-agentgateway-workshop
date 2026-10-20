// Shared lab setup and cleanup steps. Every lab starts from the base fixture (001 only),
// sets up what it needs with these steps, and returns the gateway to base when it cleans up.
// The lab markdown repeats the same steps, with the screenshots of the two intro labs.
import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page } from '@playwright/test';
import { UI } from './lab';

async function open(page: Page, path: string): Promise<void> {
  await page.goto(UI + path);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Loading permissions');
}

async function saveButton(page: Page, name: string): Promise<void> {
  const btn = page.getByRole('button', { name, exact: true }).last();
  await btn.click();
  await Promise.race([
    page.getByText('Configuration saved').first().waitFor({ timeout: 10_000 }),
    btn.waitFor({ state: 'detached', timeout: 10_000 }),
  ]).catch(() => {});
  await page.waitForTimeout(1000);
}

/** Adds the openai/* model, as in "Set up: add the OpenAI model". */
export async function addOpenAIModel(page: Page): Promise<void> {
  await open(page, '/llm/models');
  await page.getByRole('button', { name: 'Add model', exact: true }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
  await expect(d.getByRole('textbox', { name: /Incoming model match/ })).toHaveValue('openai/*');
  await d.getByRole('button', { name: 'Env var', exact: true }).click();
  await d.getByPlaceholder('ENV_VAR_NAME').fill('OPENAI_API_KEY');
  await d.getByRole('button', { name: 'Strip openai/', exact: true }).click();
  await saveButton(page, 'Save model');
  await expect(page.locator('main')).toContainText('openai/*');
}

/** Deletes a model on the Models page, as in the cleanup step "Delete the openai/* model". */
export async function deleteModel(page: Page, name = 'openai/*', shot?: (del: Locator) => Promise<void>): Promise<void> {
  await open(page, '/llm/models');
  const row = page.locator('main tbody tr').filter({ hasText: name }).first();
  const del = row.getByRole('button', { name: /^Delete/ });
  if (shot) await shot(del);
  await del.click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete (virtual )?model$/ }).click();
  await expect(page.locator('main tbody tr').filter({ hasText: name })).toHaveCount(0);
  await page.waitForTimeout(1000);
}

/** Turns on MCP from the sidebar, as in "Set up: turn on MCP". */
export async function enableMcp(page: Page): Promise<void> {
  await open(page, '/');
  // The first "Get started" in the sidebar is under MCP; the second is under Traffic.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Get started' }).first().click();
  await expect(page).toHaveURL(/\/ui\/mcp\/get-started/);
  await page.locator('main').getByRole('button', { name: 'Enable', exact: true }).click();
  await expect(page).toHaveURL(/\/ui\/mcp\/servers/);
}

/** Adds a Streamable HTTP MCP server and waits for it to be ready. */
export async function addMcpServer(page: Page, name: string, url: string): Promise<void> {
  await open(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: /Server name/ }).fill(name);
  await d.getByRole('textbox', { name: /^URL/ }).fill(url);
  await saveButton(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('ready', { timeout: 30_000 });
}

/** Clicks Apply CORS in the Tool Playground and reloads, as in "Set up: allow the Tool Playground to connect". */
export async function applyMcpCors(page: Page): Promise<void> {
  await open(page, '/mcp/playground');
  const cors = page.locator('main').getByRole('button', { name: 'Apply CORS' });
  await cors.click();
  await expect(cors).toBeHidden({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  await page.reload();
  await expect(page.locator('main')).not.toContainText('Loading permissions');
}

/** The usual MCP start: turn on MCP, add solo-docs, allow the Tool Playground. */
export async function setUpSoloDocs(page: Page): Promise<void> {
  await enableMcp(page);
  await addMcpServer(page, 'solo-docs', 'https://search.solo.io/mcp');
  await applyMcpCors(page);
}

/**
 * Turns MCP off, as in the cleanup steps "Turn off MCP": in Raw Configuration, selects from the line
 * `gateways:` to the end of the file (the `default` gateway and the `mcp:` section with every MCP server
 * and MCP policy), deletes it and saves. Fails unless `gateways:` and `mcp:` are the last two top-level
 * sections, because the lab text tells the reader to select to the end of the file.
 * `shot` runs with the lines selected, so a spec can capture the screenshot of that step.
 */
export async function turnOffMcp(page: Page, shot?: (save: Locator) => Promise<void>): Promise<void> {
  // The editor shows config.yaml without the comment lines at the top.
  const lines = readFileSync('/work/config.yaml', 'utf8').replace(/\n+$/, '').split('\n');
  while (lines.length && (lines[0].startsWith('#') || lines[0] === '')) lines.shift();
  const top = lines.map((l, i) => (/^[a-zA-Z]/.test(l) ? l.replace(/:.*/, '') : null)).filter(Boolean);
  expect(top.slice(-2), 'gateways and mcp must be the last top-level sections').toEqual(['gateways', 'mcp']);
  const start = lines.findIndex((l) => l.startsWith('gateways:'));

  await open(page, '/raw-config');
  const editor = page.locator('main .monaco-editor').first();
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < start; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await page.keyboard.press('ControlOrMeta+Shift+End');
  const save = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  if (shot) await shot(save);
  await page.keyboard.press('Delete');
  await save.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save', exact: true }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  expect(readFileSync('/work/config.yaml', 'utf8')).not.toMatch(/^(mcp|gateways):/m);
}
