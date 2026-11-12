// labs/mcp/openapi-to-mcp-local-service.md
// @fixture base
// @profiles stripe-mock
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lab, labSh } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { applyMcpCors, enableMcp, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'openapi-to-mcp-local-service');

test.describe.configure({ mode: 'serial' });

// The schema block in the lab, pasted as the reader pastes it.
const SCHEMA = `{
  "openapi": "3.0.0",
  "info": {
    "title": "Stripe Mock API (subset)",
    "version": "1.0.0",
    "description": "Three operations of the Stripe API, served by stripe-mock."
  },
  "servers": [
    { "url": "/" }
  ],
  "paths": {
    "/v1/products": {
      "get": {
        "operationId": "listProducts",
        "summary": "List products",
        "description": "Returns the product catalog. Each product has a name, a description and a default price.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Maximum number of products to return (1-100).",
            "schema": { "type": "integer" }
          }
        ],
        "responses": {
          "200": { "description": "A list of products" }
        }
      }
    },
    "/v1/prices": {
      "get": {
        "operationId": "listPrices",
        "summary": "List prices",
        "description": "Returns the prices of the products. unit_amount is in cents, so 2000 means 20.00 USD.",
        "parameters": [
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "description": "Maximum number of prices to return (1-100).",
            "schema": { "type": "integer" }
          }
        ],
        "responses": {
          "200": { "description": "A list of prices" }
        }
      }
    },
    "/v1/customers/{customer}": {
      "get": {
        "operationId": "getCustomer",
        "summary": "Get a customer",
        "description": "Returns one customer by ID.",
        "parameters": [
          {
            "name": "customer",
            "in": "path",
            "required": true,
            "description": "The customer ID, for example cus_workshop.",
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": { "description": "A customer" }
        }
      }
    }
  }
}`;

// The policy the reader pastes into Backend policies.
const BACKEND_POLICIES = `backendAuth:
  key: sk_test_123`;
const LIMIT = '{"limit": 1}';
const CUSTOMER = '{"customer": "cus_workshop"}';

/** Pastes text into a Monaco editor, as the reader does (typing would auto-close brackets). */
async function pasteInto(page: Page, editor: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
}

/** Opens the Tool Playground, initializes, and selects a stripe tool. */
async function pickTool(page: Page, tool: string, screenshot?: string) {
  await go(page, '/mcp/playground');
  // The playground reads the MCP address from the gateway config when the page loads.
  await page.waitForLoadState('networkidle');
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByText('3 tools discovered')).toBeVisible({ timeout: 30_000 });
  await main.getByRole('combobox', { name: 'Tool' }).click();
  const option = page.getByRole('option', { name: new RegExp(`^${tool}`) });
  if (screenshot) {
    for (const t of ['listProducts', 'listPrices', 'getCustomer']) {
      await expect(page.getByRole('option', { name: new RegExp(`^${t}`) })).toBeVisible();
    }
    await shot(page, screenshot, option);
  }
  await option.click();
  return main;
}

/**
 * Scrolls the first visible occurrence of `text` (in Structured content, which is pretty-printed)
 * to the middle of the window and draws a red frame over it. The frame is an overlay on <body>, because
 * the playground re-renders the JSON block and would drop any change made inside it.
 */
async function frameText(page: Page, text: string) {
  await page.locator('main').evaluate((root, t) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    // The first visible match: Raw JSON, collapsed, holds the same text.
    let range: Range | undefined;
    for (const node of nodes) {
      const i = node.data.indexOf(t);
      if (i < 0) continue;
      const candidate = document.createRange();
      candidate.setStart(node, i);
      candidate.setEnd(node, i + t.length);
      if (candidate.getBoundingClientRect().height > 0) { range = candidate; break; }
    }
    if (!range) throw new Error(`text not visible: ${t}`);
    const r = range.getBoundingClientRect();
    const top = r.top + window.scrollY;
    const left = r.left + window.scrollX;
    window.scrollTo({ top: top - window.innerHeight / 2, behavior: 'instant' });
    const frame = document.createElement('div');
    frame.id = 'agw-frame';
    Object.assign(frame.style, {
      position: 'absolute', pointerEvents: 'none', border: '3px solid #e11d48', borderRadius: '4px', zIndex: '9999',
      left: `${left - 5}px`, top: `${top - 5}px`,
      width: `${r.width + 4}px`, height: `${r.height + 4}px`,
    });
    document.body.appendChild(frame);
  }, text);
}

test('set up', async ({ page }) => {
  await enableMcp(page);
  await applyMcpCors(page);
});

test('add the Stripe mock as an MCP server', async ({ page }) => {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Server name' }).fill('stripe');
  await d.getByRole('button', { name: 'OpenAPI', exact: true }).click();
  await expect(d.getByRole('button', { name: 'OpenAPI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await d.getByRole('textbox', { name: /^URL/ }).fill('http://stripe-mock:12111');
  const inline = d.getByRole('group', { name: 'Schema source' }).getByRole('button', { name: 'Inline', exact: true });
  await shot(page, '01-add-openapi-server', inline);
  await inline.click();
  await expect(inline).toHaveAttribute('aria-pressed', 'true');
  // The dialog has two code editors: Schema, then Backend policies.
  const schema = d.locator('.monaco-editor').first();
  await pasteInto(page, schema, SCHEMA);
  await expect(schema).toContainText('A customer');
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(schema).toContainText('Stripe Mock API');
  await shot(page, '02-paste-schema', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: /^stripe\b/ });
  await expect(row).toContainText('OpenAPI');
  await expect(row).toContainText('http://stripe-mock:12111');
  await expect(row).toContainText('ready', { timeout: 30_000 });
  await shot(page, '03-server-ready');
});

test('call a tool: the API asks for a key', async ({ page }) => {
  const main = await pickTool(page, 'listProducts', '04-pick-tool');
  const call = main.getByRole('button', { name: 'Call tool' });
  await call.click();
  // This text comes only from stripe-mock's 401 response; the tool schema does not contain it.
  const toolOutput = main.locator('.mcp-text-output');
  const out = toolOutput.getByText(/Please authenticate by specifying an `Authorization` header/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await expect(toolOutput.first()).toContainText("Authorization was ''");
  await shot(page, '05-needs-key', out);
});

test('give the gateway the API key in Backend policies', async ({ page }) => {
  await go(page, '/mcp/servers');
  const edit = page.locator('main').getByRole('row', { name: /^stripe\b/ }).getByRole('button', { name: 'Edit server' });
  await shot(page, '06-edit-server', edit);
  await edit.click();
  const d = page.getByRole('dialog');
  await expect(d.getByRole('heading', { name: 'Edit MCP server' })).toBeVisible();
  // The code editor that follows the Backend policies label; the Schema editor comes before it.
  const policies = d.getByText('Backend policies', { exact: true }).locator('xpath=following::div[contains(@class,"monaco-editor")][1]');
  await policies.scrollIntoViewIfNeeded();
  await pasteInto(page, policies, BACKEND_POLICIES);
  await expect(policies).toContainText('sk_test_123');
  // Click outside the editor, so its suggestion popup is not in the screenshot.
  await d.getByRole('heading', { name: 'Edit MCP server' }).click();
  await shot(page, '07-backend-policies', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  await expect
    .poll(() => readConfig().mcp?.targets)
    .toEqual([{ name: 'stripe', openapi: { host: 'http://stripe-mock:12111', schema: SCHEMA }, policies: { backendAuth: { key: 'sk_test_123' } } }]);
});

test('check it: list products', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await pickTool(page, 'listProducts');
  const query = main.locator('.monaco-editor').first();
  await pasteInto(page, query, LIMIT);
  await expect(query).toContainText('limit');
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '08-call-list-products', call);
  await call.click();
  // stripe-mock's sample product. The query, the schema and the tool descriptions contain neither string.
  const toolOutput = main.locator('.mcp-text-output');
  const out = toolOutput.getByText(/"Comfortable gray cotton t-shirt"/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await expect(toolOutput.first()).toContainText(/"object":\s*"product"/);
  await expect(toolOutput.first()).toContainText(/"name":\s*"T-shirt"/);
  await shot(page, '09-products', out);
});

test('check it: get a customer by ID', async ({ page }) => {
  const main = await pickTool(page, 'getCustomer');
  const path = main.locator('.monaco-editor').first();
  await pasteInto(page, path, CUSTOMER);
  await expect(path).toContainText('cus_workshop');
  const call = main.getByRole('button', { name: 'Call tool' });
  await shot(page, '10-call-get-customer', call);
  await call.click();
  // The ID the reader sent comes back as the customer's "id", next to fields only the API returns.
  const toolOutput = main.locator('.mcp-text-output');
  const out = toolOutput.getByText(/"object":\s*"customer"/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await expect(toolOutput.first()).toContainText(/"id":\s*"cus_workshop"/);
  await expect(toolOutput.first()).toContainText(/"invoice_prefix":/);
  await frameText(page, '"id": "cus_workshop"');
  await shot(page, '11-customer');
});

const CURL = `SESSION=$(curl -s -D - -o /dev/null http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \\
  | grep -i '^mcp-session-id:' | awk '{print $2}' | tr -d '\\r')
curl -s http://localhost:4001/mcp \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Mcp-Session-Id: $SESSION" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"listPrices","arguments":{"query":{"limit":1}}}}'`;

test('optional curl check', async () => {
  const r = labSh(CURL);
  console.log(r.stdout.slice(0, 600));
  expect(r.stdout).toContain('\\"unit_amount\\":2000');
  expect(r.stdout).toContain('\\"interval\\":\\"month\\"');
});

test('clean up: turn off MCP', async ({ page }) => {
  await turnOffMcp(page, (save) => shot(page, '12-turn-off-mcp', save));
});
