// labs/platform/metrics-and-tracing.md
// @fixture llm-ready
// @profiles observability,mock-llm-faults
import { expect, test, type Page } from '@playwright/test';
import { readConfig } from '../../lib/config';
import { chat, lab, sh } from '../../lib/lab';

const { go, shot, save } = lab('platform', 'metrics-and-tracing');

test.describe.configure({ mode: 'serial' });

// The reader opens these at localhost:3000 and localhost:9090. The test browser shares the gateway's
// network namespace, so it reaches the helpers by their Compose service names.
const GRAFANA = 'http://grafana:3000';
const PROMETHEUS = 'http://prometheus:9090';
const TEMPO = 'http://tempo:3200';

async function promQuery(q: string): Promise<any[]> {
  const res = await fetch(`${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(q)}`);
  const body = await res.json();
  return body.data.result;
}

test('Prometheus scrapes the gateway', async ({ page }) => {
  await expect.poll(async () => {
    const r = await (await fetch(`${PROMETHEUS}/api/v1/targets`)).json();
    return r.data.activeTargets.map((t: any) => `${t.labels.job}:${t.health}`).join(',');
  }, { timeout: 60_000 }).toBe('agentgateway:up');
  await page.goto(`${PROMETHEUS}/targets`);
  const row = page.getByText('http://agentgateway:15020/metrics').first();
  await expect(row).toBeVisible();
  await expect(page.getByRole('button', { name: 'agentgateway 1 / 1 up' })).toBeVisible();
  await shot(page, '01-prometheus-targets', page.getByRole('row').filter({ hasText: 'agentgateway:15020/metrics' }));
});

test('turn on tracing', async ({ page }) => {
  await go(page, '/settings/observability');
  const card = page.locator('main').getByRole('button', { name: /Tracing/ });
  await shot(page, '02-observability-settings', card);
  await card.click();
  const d = page.getByRole('dialog');
  await d.getByPlaceholder('host:port or unix:/path/to/socket').fill('tempo:4317');
  await expect(d.getByRole('combobox', { name: 'Protocol' })).toHaveText('gRPC');
  await d.getByPlaceholder('0.1', { exact: true }).fill('true');
  await shot(page, '03-tracing', d.getByRole('button', { name: 'Save policy' }));
  await save(page, 'Save policy');
  const t = readConfig().frontendPolicies.tracing;
  console.log(JSON.stringify(t));
  expect(t).toEqual({ host: 'tempo:4317', protocol: 'grpc', randomSampling: true });
});

test('send chat requests', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  // Space the requests so Prometheus (every 5 s) scrapes between them and sees the counters go up.
  for (const n of [1, 2, 3]) {
    const reply = await chat(page, { model: 'openai/*', specific: 'gpt-6-luna', prompt: `Reply with exactly: PONG-${n}` });
    expect(reply).toContain(`PONG-${n}`);
    expect(reply).toContain('OK');
    if (n < 3) await page.waitForTimeout(7000);
  }
  await shot(page, '04-chat', page.locator('.chat-message.assistant').last());
});

/** The dashboard panel with this title. */
function panel(page: Page, title: string) {
  return page.getByRole('region', { name: title, exact: true });
}

test('check it: token and request metrics in Prometheus and Grafana', async ({ page }) => {
  await expect.poll(async () => {
    const r = await promQuery('sum(agentgateway_gen_ai_client_token_usage_sum{gen_ai_token_type="input", gen_ai_request_model="gpt-6-luna"})');
    return Number(r[0]?.value[1] ?? 0);
  }, { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(async () => {
    const r = await promQuery('sum(agentgateway_requests_total{status="200", protocol="llm"})');
    return Number(r[0]?.value[1] ?? 0);
  }, { timeout: 30_000 }).toBe(3);

  // The lab's optional curl, with the Compose service name in place of localhost.
  const curl = sh(`curl -s http://prometheus:9090/api/v1/query \\
  --data-urlencode 'query=sum by (gen_ai_token_type) (agentgateway_gen_ai_client_token_usage_sum{gen_ai_request_model="gpt-6-luna"})'`).stdout;
  console.log(curl);
  expect(curl).toMatch(/"gen_ai_token_type":"input"\},"value":\[[\d.]+,"[1-9]\d*"\]/);

  await page.goto(`${GRAFANA}/dashboards`);
  const link = page.getByRole('link', { name: 'AgentGateway Dashboard' });
  await shot(page, '05-grafana-dashboards', link);
  await link.click();
  // The Total panels count in 1 minute steps, so they show "No data" or 0 until a minute boundary passes
  // after the requests. Reload until they fill in, as the lab tells the reader to.
  await expect.poll(async () => {
    await page.reload();
    const p = panel(page, 'Total Input Tokens');
    await expect(p).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const t = (await p.innerText()).replace(/\s+/g, ' ');
    console.log(t);
    return Number(t.match(/^Total Input Tokens ([\d.]+)/)?.[1] ?? 0);
  }, { timeout: 180_000, intervals: [10_000] }).toBeGreaterThan(0);
  for (const t of ['Total Requests', 'Total Output Tokens']) {
    expect(Number((await panel(page, t).innerText()).replace(/\s+/g, ' ').match(/ ([\d.]+)$/)?.[1] ?? 0)).toBeGreaterThan(0);
  }
  await shot(page, '06-dashboard-overview', panel(page, 'Total Input Tokens'));

  await page.mouse.move(860, 600);
  await page.mouse.wheel(0, 560);
  const table = panel(page, 'Token Usage by Model');
  await expect(table).toContainText('gpt-6-luna', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await shot(page, '07-dashboard-tokens-by-model', table);
});

test('check it: a trace in Grafana Explore', async ({ page }) => {
  await expect.poll(async () => {
    const q = '{ span.gen_ai.request.model = "gpt-6-luna" }';
    const r = await (await fetch(`${TEMPO}/api/search?q=${encodeURIComponent(q)}`)).json();
    return r.traces?.length ?? 0;
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

  await page.goto(`${GRAFANA}/explore`);
  // Hide Grafana's menu so both Explore panes fit on screen.
  const undock = page.getByRole('button', { name: 'Undock menu' });
  await shot(page, '08-explore', undock);
  await undock.click();
  await page.getByTestId('data-testid Select a data source').click();
  const tempo = page.getByRole('button', { name: /^Tempo/ });
  await shot(page, '09-explore-tempo', tempo);
  await tempo.click();
  await page.getByLabel('Search', { exact: true }).click();
  await page.getByRole('combobox', { name: 'select span-name value' }).click();
  await page.getByText('POST /v1/chat/completions', { exact: true }).last().click();
  await page.getByTestId('data-testid RefreshPicker run button').click();
  const results = page.getByTestId('data-testid explorer scroll view');
  const traceLink = page.getByTestId('data-testid Data link').first();
  await expect(traceLink).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('data-testid Data link')).toHaveCount(3);
  await shot(page, '10-trace-search', traceLink);
  await traceLink.click();
  // The trace opens in a second pane. Close the search pane to give the trace the full width.
  const closeLeft = page.getByRole('button', { name: 'Close split pane' }).first();
  await expect(closeLeft).toBeVisible({ timeout: 30_000 });
  await shot(page, '11-trace-opened', closeLeft);
  await closeLeft.click();
  const span = page.getByRole('switch', { name: /^agentgateway POST \/v1\/chat\/completions/ });
  await expect(span).toBeVisible({ timeout: 30_000 });
  await shot(page, '12-trace', span.locator('..'));
  await span.click();
  const attrsToggle = page.getByText('Span attributes', { exact: true }).first();
  await expect(attrsToggle).toBeVisible({ timeout: 15_000 });
  await attrsToggle.click();
  const tokens = page.getByRole('row').filter({ hasText: 'gen_ai.usage.input_tokens' }).first();
  await expect(tokens).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('row').filter({ hasText: 'gen_ai.request.model' }).first()).toContainText('gpt-6-luna');
  await expect(page.getByRole('row').filter({ hasText: 'gen_ai.usage.output_tokens' }).first()).toContainText(/\d/);
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(800);
  await shot(page, '13-span-attributes', tokens);
});

async function addModel(page: Page, name: string, url: string) {
  await go(page, '/llm/models');
  const add = page.getByRole('button', { name: 'Add model', exact: true }).first();
  await add.click();
  const d = page.getByRole('dialog');
  await d.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'Custom', exact: true }).click();
  await d.getByRole('textbox', { name: /Incoming model match/ }).fill(name);
  await d.getByPlaceholder('https://llm.internal.example.com').fill(url);
  await d.getByRole('button', { name: 'Explicit', exact: true }).click();
  await d.getByRole('combobox', { name: 'Explicit outgoing model' })
    .or(d.getByRole('textbox', { name: 'Explicit outgoing model' })).first().fill('mock-gpt');
  await d.getByRole('heading', { name: 'Add model' }).click();
  await shot(page, '14-add-503-model', d.getByRole('button', { name: 'Save model' }));
  await save(page, 'Save model');
}

test('add a model that always fails', async ({ page }) => {
  await addModel(page, 'mock-llm-503', 'http://mock-llm-503:8000/v1');
  const m = readConfig().llm.models.find((x: any) => x.name === 'mock-llm-503');
  console.log(JSON.stringify(m));
  expect(m.provider).toEqual({ custom: { formats: [{ type: 'completions' }] } });
  expect(m.params).toEqual({ model: 'mock-gpt', baseUrl: 'http://mock-llm-503:8000/v1' });
});

test('send requests that fail', async ({ page }) => {
  await page.waitForTimeout(2000);
  await go(page, '/llm/playground');
  const main = page.locator('main');
  for (const n of [1, 2, 3]) {
    await main.getByRole('combobox', { name: 'Model' }).click();
    await page.getByRole('option', { name: 'mock-llm-503' }).click();
    await main.getByPlaceholder('Ask a test question...').fill('Hello');
    await main.getByRole('button', { name: 'Send' }).click();
    const banner = main.getByText('Playground request failed');
    await expect(banner.first()).toBeVisible({ timeout: 30_000 });
    if (n < 3) await page.waitForTimeout(7000);
  }
  const banner = main.getByText('Playground request failed').last().locator('..');
  console.log(await banner.innerText());
  await expect(banner).toContainText('503');
  await shot(page, '15-chat-503', banner);
  await expect.poll(async () => {
    const r = await promQuery('sum(agentgateway_requests_total{status="503"})');
    return Number(r[0]?.value[1] ?? 0);
  }, { timeout: 30_000 }).toBe(3);
});

test('check it: the error-rate alert fires', async ({ page }) => {
  await expect.poll(async () => {
    const r = await (await fetch(`${PROMETHEUS}/api/v1/alerts`)).json();
    return r.data.alerts.filter((a: any) => a.labels.alertname === 'AgentGatewayHighErrorRate').map((a: any) => a.state).join(',');
  }, { timeout: 120_000, intervals: [5_000] }).toBe('firing');
  await page.goto(`${PROMETHEUS}/alerts`);
  const rule = page.getByText('AgentGatewayHighErrorRate', { exact: true }).first();
  await expect(rule).toBeVisible();
  await shot(page, '16-alerts', rule);
  await rule.click();
  const details = page.getByText('AgentGateway default/default has >5% error rate').first();
  await expect(details).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '17-alert-firing', details);
});

test('clean up', async ({ page }) => {
  await go(page, '/llm/models');
  const m = page.locator('main').getByRole('row').filter({ has: page.getByText('mock-llm-503', { exact: true }) });
  await m.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: /^Delete model$/ }).click();
  await expect(m).toHaveCount(0);
  await page.waitForTimeout(1000);

  await go(page, '/settings/observability');
  await page.locator('main').getByRole('button', { name: /Tracing/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete policy' }).click();
  await page.waitForTimeout(1500);
  expect(readConfig().frontendPolicies.tracing).toBeUndefined();
});
