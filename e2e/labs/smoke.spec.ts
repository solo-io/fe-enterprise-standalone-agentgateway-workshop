// Harness self-check: the UI loads and the config mount works.
import { expect, test } from '@playwright/test';
import { readConfig } from '../lib/config';
import { lab } from '../lib/lab';

const { go } = lab('setup', 'smoke');

test('UI loads and config is mounted', async ({ page }) => {
  await go(page, '/');
  await expect(page.getByText('v2026.10.0')).toBeVisible();
  expect(readConfig().llm.port).toBe(4000);
});
