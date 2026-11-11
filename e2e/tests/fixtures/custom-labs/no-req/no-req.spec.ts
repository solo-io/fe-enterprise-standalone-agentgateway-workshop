// custom-labs/no-req/no-req.md
import { expect, test } from '@playwright/test';
import { lab } from '../lib/lab';

const { go, shot } = lab('custom', 'no-req');

test('first page loads', async ({ page }) => {
  await go(page, '/');
  await shot(page, '01-a');
});

test('second page loads', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '02-b');
  await expect(page.locator('main')).toBeVisible();
});
