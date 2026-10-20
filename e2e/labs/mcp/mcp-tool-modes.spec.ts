// labs/mcp/mcp-tool-modes.md
// @fixture base
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lab } from '../../lib/lab';
import { setUpSoloDocs, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-tool-modes');

test.describe.configure({ mode: 'serial' });

const QUESTION = 'What is agentgateway?';
const PRODUCT = 'solo-enterprise-for-agentgateway';
const ARGS = `{"query": "${QUESTION}", "product": "${PRODUCT}", "limit": 1}`;
const CODE = `await search({ query: "${QUESTION}", product: "${PRODUCT}", limit: 1 })`;

/** Opens MCP Servers > Settings, sets Tool mode, and saves. */
async function setToolMode(page: Page, mode: string, shotName: string): Promise<void> {
  await go(page, '/mcp/servers');
  await page.locator('main').getByRole('button', { name: 'Settings' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Tool mode' }).click();
  await page.getByRole('option', { name: new RegExp(`^${mode}\\s+[A-Z]`) }).click();
  await expect(d.getByRole('combobox', { name: 'Tool mode' })).toContainText(mode);
  await shot(page, shotName, d.getByRole('button', { name: 'Save settings' }));
  await save(page, 'Save settings');
  await page.waitForTimeout(2000);
}

/** Opens the Tool Playground fresh and clicks Initialize. */
async function initialize(page: Page, tools: number): Promise<Locator> {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByText(`${tools} tools discovered`)).toBeVisible({ timeout: 30_000 });
  return main;
}

async function selectTool(page: Page, main: Locator, name: string): Promise<void> {
  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: new RegExp(`^${name}\\b`) }).click();
}

/** Pastes text into a Monaco code editor, the way the reader pastes. */
async function paste(page: Page, editor: Locator, text: string): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
}

test('set up', async ({ page }) => {
  await setUpSoloDocs(page);
});

test('Search mode: two tools replace the tool list', async ({ page }) => {
  await setToolMode(page, 'Search', '01-tool-mode-search');
  const main = await initialize(page, 2);
  await expect(main.getByText(/^get_tool$/)).toBeVisible();
  await expect(main.getByText(/^invoke_tool$/)).toBeVisible();
  await shot(page, '02-search-tools', main.getByText('2 tools discovered'));

  await selectTool(page, main, 'get_tool');
  await main.getByRole('textbox', { name: /^name/ }).fill('search');
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '03-get-tool', call);
  await call.click();
  // get_tool answers with the tool's definition: "tool_description" and its input schema.
  const out = main.getByText(/"tool_description"/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-get-tool-result', out);

  await selectTool(page, main, 'invoke_tool');
  await main.getByRole('textbox', { name: /^name/ }).fill('search');
  const editor = main.locator('.monaco-editor').first();
  await paste(page, editor, ARGS);
  await expect(editor).toContainText('limit');
  await call.click();
  // Search hits carry a score and a docs URL; the prompt and tool description have neither.
  const toolOutput = main.locator('.mcp-text-output');
  const hit = toolOutput.getByText(/Result 1 \(Score/).first();
  await expect(hit).toBeVisible({ timeout: 60_000 });
  await expect(toolOutput.first()).toContainText('Source: https://docs.solo.io');
  // The get_tool output from the previous call is gone from the Result panel.
  await expect(main.getByText(/"tool_description"/)).toHaveCount(0);
  await shot(page, '05-invoke-tool', call);
  await shot(page, '06-invoke-tool-result', hit);
});

test('Code mode: one run_code tool', async ({ page }) => {
  await setToolMode(page, 'Code', '07-tool-mode-code');
  const main = await initialize(page, 1);
  await expect(main.getByText(/^run_code$/)).toBeVisible();
  await selectTool(page, main, 'run_code');
  await main.getByRole('textbox', { name: /^code/ }).fill(CODE);
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '08-run-code', call);
  await call.click();
  const hit = main.getByText(/Result 1 \(Score/).first();
  await expect(hit).toBeVisible({ timeout: 60_000 });
  await expect(main).toContainText('Source: https://docs.solo.io');
  await shot(page, '09-run-code-result', hit);
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '10-turn-off-mcp', save));
});
