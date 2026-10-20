// labs/mcp/openapi-to-mcp-local-service.md
// @fixture mcp-ready
// @profiles stripe-mock
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lab, sh } from '../../lib/lab';
import { readConfig } from '../../lib/config';

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

// The line the reader pastes in Raw Configuration, after a new line under "- name: stripe".
const AUTH_LINE = '  policies: { backendAuth: { key: sk_test_123 } }';
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
  const main = page.locator('main');
  await main.getByRole('button', { name: 'Initialize' }).click();
  await expect(main.getByText('6 tools discovered')).toBeVisible({ timeout: 30_000 });
  await main.getByRole('combobox', { name: 'Tool' }).click();
  const option = page.getByRole('option', { name: new RegExp(`^${tool}`) });
  if (screenshot) {
    for (const t of ['stripe_listProducts', 'stripe_listPrices', 'stripe_getCustomer']) {
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

test('add the Stripe mock as an MCP server', async ({ page }) => {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Server name' }).fill('stripe');
  await d.getByRole('radio', { name: 'OpenAPI' }).click();
  await d.getByRole('textbox', { name: /^URL/ }).fill('http://stripe-mock:12111');
  await shot(page, '01-add-openapi-server', d.getByRole('radio', { name: 'Inline' }));
  await d.getByRole('radio', { name: 'Inline' }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), SCHEMA);
  await expect(d.locator('.monaco-editor')).toContainText('A customer');
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(d.locator('.monaco-editor')).toContainText('Stripe Mock API');
  await shot(page, '02-paste-schema', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: /^stripe\b/ });
  await expect(row).toContainText('OpenAPI');
  await expect(row).toContainText('http://stripe-mock:12111');
  await expect(row).toContainText('ready', { timeout: 30_000 });
  await shot(page, '03-server-ready');
});

test('call a tool: the API asks for a key', async ({ page }) => {
  const main = await pickTool(page, 'stripe_listProducts', '04-pick-tool');
  const call = main.getByRole('button', { name: 'Call tool' });
  await call.click();
  // This text comes only from stripe-mock's 401 response; the tool schema does not contain it.
  const toolOutput = main.locator('.mcp-text-output');
  const out = toolOutput.getByText(/Please authenticate by specifying an `Authorization` header/).first();
  await expect(out).toBeVisible({ timeout: 30_000 });
  await expect(toolOutput.first()).toContainText("Authorization was ''");
  await shot(page, '05-needs-key', out);
});

test('give the gateway the API key in Raw Configuration', async ({ page }) => {
  await go(page, '/raw-config');
  const line = page.locator('.view-line', { hasText: '- name: stripe' });
  // The reader scrolls the editor down to the stripe target.
  await page.locator('.monaco-editor').first().hover();
  for (let i = 0; i < 40 && !(await line.count()); i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(150);
  }
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(800);
  await line.click();
  await page.keyboard.press('End');
  await shot(page, '06-raw-config-line', line);
  await page.keyboard.press('Enter');
  // The reader pastes the line from the lab: it starts with two spaces, so it lines up with "name".
  await page.keyboard.insertText(AUTH_LINE);
  const edited = page.locator('.view-line', { hasText: 'backendAuth' });
  await expect.poll(async () => (await edited.innerText()).replace(/ /g, ' ').trim()).toBe(AUTH_LINE.trim());
  const saveBtn = page.locator('main').getByRole('button', { name: 'Save', exact: true });
  await shot(page, '07-raw-config-key', saveBtn);
  await saveBtn.click();
  await expect
    .poll(() => readConfig().mcp.targets.find((t: any) => t.name === 'stripe')?.policies)
    .toEqual({ backendAuth: { key: 'sk_test_123' } });
});

test('check it: list products', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await pickTool(page, 'stripe_listProducts');
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
  const main = await pickTool(page, 'stripe_getCustomer');
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
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stripe_listPrices","arguments":{"query":{"limit":1}}}}'`;

test('optional curl check', async () => {
  const r = sh(CURL);
  console.log(r.stdout.slice(0, 600));
  expect(r.stdout).toContain('\\"unit_amount\\":2000');
  expect(r.stdout).toContain('\\"interval\\":\\"month\\"');
});

test('clean up', async ({ page }) => {
  await go(page, '/mcp/servers');
  const row = page.locator('main').getByRole('row', { name: /^stripe\b/ });
  await row.getByRole('button', { name: 'Delete server' }).click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Delete server' });
  await shot(page, '12-delete-server', confirm);
  await confirm.click();
  await expect(row).toBeHidden();
});
