// 001-set-up-standalone-agentgateway.md
// Host port publishing is checked statically (check-ports.sh); the harness publishes none.
import { expect, test } from '@playwright/test';
import { lab, labSh, sh } from '../lib/lab';

const { go, shot } = lab('setup', '001');

test('gateway is licensed and running in standalone mode', async () => {
  const runtime = await (await fetch('http://localhost:15000/api/runtime')).json();
  expect(runtime.build.version).toBe('v2026.10.0');
  expect(runtime.ui.gatewayMode).toBe('standalone');
  expect(runtime.license.state).toBe('running');
  // The lab's optional curl check.
  const r = labSh(`curl -s http://localhost:15000/api/runtime | grep -o '"state":"[a-z]*"'`);
  expect(r.stdout.trim()).toBe('"state":"running"');
});

test('compose publishes the ports the labs use', () => {
  const r = sh('/repo/e2e/check-ports.sh');
  expect(r.code, r.stdout).toBe(0);
});

test('UI tour', async ({ page }) => {
  await go(page, '/');
  await expect(page.getByRole('heading', { name: 'Gateway Overview' })).toBeVisible();
  await expect(page.getByText('v2026.10.0')).toBeVisible();
  await shot(page, '01-home', page.getByText('v2026.10.0'));

  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const item of ['Models', 'Providers', 'Policies', 'Guardrails', 'Chat Playground', 'Raw Configuration']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible();
  }
  await shot(page, '02-sidebar', nav);

  await go(page, '/raw-config');
  await expect(page.locator('main')).toContainText('port: 4000');
  await shot(page, '03-raw-config');
});
