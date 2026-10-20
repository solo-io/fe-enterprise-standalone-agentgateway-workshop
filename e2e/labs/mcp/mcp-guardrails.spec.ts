// labs/mcp/mcp-guardrails.md
// @fixture base
// @profiles mcp-guardrails
// @docker yes
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { helper, lab } from '../../lib/lab';
import { readConfig } from '../../lib/config';
import { mcpConnect } from '../../lib/mcp';
import { applyMcpCors, enableMcp, turnOffMcp } from '../../lib/setup';

const { go, shot, save } = lab('mcp', 'mcp-guardrails');
const MCP = 'http://localhost:4001/mcp';
const JWKS = readFileSync('/repo/lib/jwt/public-jwks.json', 'utf8').trim();
const token = (p: string) => readFileSync(`/repo/lib/jwt/tokens/${p}.jwt`, 'utf8').trim();
const REQUESTER = token('requester');
const BUYER = token('buyer');
const POLICY = '/work/extmcp/authz.yaml';

test.describe.configure({ mode: 'serial' });

function policyCard(page: Page, name: string) {
  return page.locator('main').getByRole('button', { name: new RegExp(`^(enabled|disabled)\\s*${name}`) });
}

async function pasteInto(page: Page, editor: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.locator('.view-lines').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Delete');
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  await page.keyboard.press('ControlOrMeta+V');
}

/** Opens the Tool Playground with a token and initializes a session. Returns the main area. */
async function connect(page: Page, tok: string, shotName?: string): Promise<Locator> {
  await go(page, '/mcp/playground');
  const main = page.locator('main');
  await main.getByText('Authorization header', { exact: true }).click();
  await main.getByPlaceholder('Optional token').fill(tok);
  const init = main.getByRole('button', { name: 'Initialize' });
  if (shotName) await shot(page, shotName, init);
  await init.click();
  await expect(main.getByRole('button', { name: 'Reset' })).toBeVisible({ timeout: 30_000 });
  return main;
}

async function toolOptions(page: Page): Promise<string[]> {
  await page.locator('main').getByRole('combobox', { name: 'Tool' }).click();
  await expect(page.getByRole('option').first()).toBeVisible();
  const names = (await page.getByRole('option').allInnerTexts()).map((o) => o.split(' - ')[0].trim());
  return names;
}

/** Selects a tool, fills its arguments, calls it, and returns the tool output text. */
async function callTool(page: Page, tool: string, args: Record<string, string>, shotName?: string): Promise<string> {
  const main = page.locator('main');
  await main.getByRole('combobox', { name: 'Tool' }).click();
  await page.getByRole('option', { name: new RegExp(`^${tool}\\b`) }).first().click();
  for (const [k, v] of Object.entries(args)) {
    await main.getByRole('textbox', { name: new RegExp(`^${k}\\b`) }).or(main.getByRole('spinbutton', { name: new RegExp(`^${k}\\b`) })).first().fill(v);
  }
  const result = main.getByRole('heading', { name: 'Result', exact: true }).locator('xpath=../..');
  const before = await result.innerText();
  const resp = page.waitForResponse((r) => r.url().includes(':4001/mcp') && r.request().method() === 'POST' && r.request().postData()?.includes('tools/call') === true, { timeout: 60_000 });
  await main.getByRole('button', { name: 'Call tool' }).click();
  await resp;
  await expect.poll(() => result.innerText(), { timeout: 30_000 }).not.toBe(before);
  const text = await result.innerText();
  if (shotName) await shot(page, shotName, result);
  console.log(`--- ${tool} ${JSON.stringify(args)}\n${text}`);
  return text;
}

test('set up', async ({ page }) => {
  await enableMcp(page);
  await applyMcpCors(page);
});

test('add the procurement MCP server', async ({ page }) => {
  await go(page, '/mcp/servers');
  await page.getByRole('button', { name: 'Add server' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByRole('textbox', { name: 'Server name' }).fill('procurement');
  await d.getByRole('textbox', { name: /^URL/ }).fill('http://procurement-mcp:8000/mcp');
  await shot(page, '01-add-server', d.getByRole('button', { name: 'Save server' }));
  await save(page, 'Save server');
  const row = page.locator('main').getByRole('row', { name: /^procurement\b/ });
  await expect(row).toContainText('ready', { timeout: 30_000 });
});

test('require a token', async ({ page }) => {
  await go(page, '/mcp/policies');
  await policyCard(page, 'MCP authentication').click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Inline JSON', exact: true }).click();
  await pasteInto(page, d.locator('.monaco-editor').first(), JWKS);
  await d.getByRole('textbox', { name: 'Issuer' }).fill('solo-workshop');
  await d.getByPlaceholder('mcp://gateway').fill('agentgateway');
  await d.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(d).not.toContainText('Invalid MCP authentication policy');
  await shot(page, '03-authn', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  await go(page, '/mcp/policies');
  await expect(policyCard(page, 'MCP authentication')).toContainText('enabled');
});

test('baseline: the buyer sees every tool and the bank account', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await connect(page, BUYER, '04-buyer-token');
  await expect(main).toContainText('5 tools discovered');
  const opts = await toolOptions(page);
  expect(opts).toContain('delete_supplier');
  await shot(page, '05-baseline-tools', page.getByRole('option', { name: /^delete_supplier/ }).first());
  await page.keyboard.press('Escape');
  const text = await callTool(page, 'get_supplier', { id: 'SUP-001' }, '06-baseline-supplier');
  expect(text).toContain('004815162342');
  expect(text).toContain('94-3175520');
});

test('add the authorization processor', async ({ page }) => {
  await go(page, '/mcp/policies');
  const card = policyCard(page, 'MCP guardrails');
  await shot(page, '07-guardrails-card', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Add processor' }).first().click();
  await d.getByRole('textbox', { name: /^Host/ }).fill('extmcp-authz:9001');
  await expect(d.getByRole('combobox', { name: 'Processor 1 failure mode' })).toHaveText('Fail closed');
  await d.getByRole('textbox', { name: 'tools/call, prompts/*, or *' }).fill('tools/list');
  await d.getByRole('combobox', { name: 'Phase' }).click();
  await page.getByRole('option', { name: /^Response/ }).click();
  await d.getByRole('button', { name: 'Add', exact: true }).first().click();
  await d.getByRole('textbox', { name: 'metadata key' }).fill('persona');
  await d.getByRole('textbox', { name: 'CEL expression' }).fill('jwt.persona');
  await d.getByRole('button', { name: 'Add', exact: true }).last().click();
  await d.getByRole('textbox', { name: 'metadata key' }).fill('sub');
  await d.getByRole('textbox', { name: 'CEL expression' }).fill('jwt.sub');
  await d.getByRole('button', { name: 'Add', exact: true }).last().click();
  await shot(page, '08-authz-processor', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const p = readConfig().mcp.policies.mcpGuardrails.processors[0];
  console.log(JSON.stringify(p));
  expect(p.host).toBe('extmcp-authz:9001');
  expect(p.methods).toEqual({ 'tools/call': 'request', 'tools/list': 'response' });
  expect(p.metadata).toEqual({ persona: 'jwt.persona', sub: 'jwt.sub' });
});

test('add the redaction processor', async ({ page }) => {
  await go(page, '/mcp/policies');
  await policyCard(page, 'MCP guardrails').click();
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Add processor' }).first().click();
  await d.getByRole('textbox', { name: /^Host/ }).last().fill('extmcp-redact:9001');
  await d.getByRole('combobox', { name: 'Processor 2 failure mode' }).click();
  await page.getByRole('option', { name: /^Fail open/ }).click();
  // Replace the default tools/call Request row with tools/call Response.
  await d.getByRole('button', { name: 'Remove' }).last().click();
  await d.getByRole('textbox', { name: 'tools/call, prompts/*, or *' }).last().fill('tools/call');
  await d.getByRole('combobox', { name: 'Phase' }).last().click();
  await page.getByRole('option', { name: /^Response/ }).click();
  await d.getByRole('button', { name: 'Add', exact: true }).nth(-2).click();
  await shot(page, '09-redact-processor', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const ps = readConfig().mcp.policies.mcpGuardrails.processors;
  console.log(JSON.stringify(ps));
  expect(ps).toHaveLength(2);
  expect(ps[1].host).toBe('extmcp-redact:9001');
  expect(ps[1].failureMode).toBe('failOpen');
  expect(ps[1].methods).toEqual({ 'tools/call': 'response' });
});

test('check it: the buyer is scoped, limited and masked', async ({ page }) => {
  await page.waitForTimeout(2000);
  const main = await connect(page, BUYER);
  await expect(main).toContainText('4 tools discovered');
  const opts = await toolOptions(page);
  expect(opts.sort()).toEqual(['create_purchase_order', 'get_supplier', 'list_purchase_orders', 'send_supplier_email']);
  await shot(page, '10-buyer-tools', page.getByRole('listbox').first());
  await page.keyboard.press('Escape');

  let text = await callTool(page, 'get_supplier', { id: 'SUP-001' }, '11-masked');
  expect(text).toContain('<BANK_ACCOUNT>');
  expect(text).toContain('<TAX_ID>');

  text = await callTool(page, 'create_purchase_order', { supplier: 'SUP-002', amount: '25000', description: 'Forklift' }, '12-over-limit');
  expect(text).toContain('amount $25000 exceeds the $10000 limit for buyer; approval required');

  text = await callTool(page, 'create_purchase_order', { supplier: 'SUP-002', amount: '5000', description: 'Pallet racking' });
  expect(text).toContain('"status":"created"');

  text = await callTool(page, 'send_supplier_email', { to: 'x@gmail.com', subject: 'Bank details', body: 'See attached' }, '13-email-denied');
  expect(text).toContain('recipient domain gmail.com not allowed');
});

test('check it: the requester sees three tools', async ({ page }) => {
  const main = await connect(page, REQUESTER);
  await expect(main).toContainText('3 tools discovered');
  const opts = await toolOptions(page);
  expect(opts.sort()).toEqual(['create_purchase_order', 'get_supplier', 'list_purchase_orders']);
  await shot(page, '14-requester-tools', page.getByRole('listbox').first());
  await page.keyboard.press('Escape');
  const s = await mcpConnect(MCP, REQUESTER);
  const r = await s.call('delete_supplier', { id: 'SUP-003' });
  expect(r.text).toContain('persona requester may not call delete_supplier');
});

test('compare failure modes', async ({ page }) => {
  helper('stop', 'extmcp-redact');
  await connect(page, BUYER);
  let text = await callTool(page, 'get_supplier', { id: 'SUP-001' }, '15-redact-down');
  expect(text).toContain('004815162342');

  helper('stop', 'extmcp-authz');
  text = await callTool(page, 'list_purchase_orders', {}, '16-authz-down');
  expect(text).toContain('mcpGuardrails checkRequest failed');

  helper('start', 'extmcp-authz');
  helper('start', 'extmcp-redact');
  await page.waitForTimeout(3000);
  await page.reload();
  await connect(page, BUYER);
  text = await callTool(page, 'get_supplier', { id: 'SUP-001' });
  expect(text).toContain('<BANK_ACCOUNT>');
});

test('change the policy without touching the gateway', async ({ page }) => {
  const orig = readFileSync(POLICY, 'utf8');
  const lowered = orig.replace('    poLimit: 10000', '    poLimit: 2500');
  expect(lowered).not.toBe(orig);
  writeFileSync(POLICY, lowered);
  await page.waitForTimeout(7000);
  await connect(page, BUYER);
  const text = await callTool(page, 'create_purchase_order', { supplier: 'SUP-002', amount: '5000', description: 'Pallet racking' }, '17-new-limit');
  expect(text).toContain('amount $5000 exceeds the $2500 limit for buyer; approval required');
});

test('clean up', async ({ page }) => {
  writeFileSync(POLICY, readFileSync(POLICY, 'utf8').replace('    poLimit: 2500', '    poLimit: 10000'));
  expect(readFileSync(POLICY, 'utf8')).toBe(readFileSync('/repo/setup/extmcp/authz.yaml', 'utf8'));
  await turnOffMcp(page, (save) => shot(page, '18-turn-off-mcp', save));
});
