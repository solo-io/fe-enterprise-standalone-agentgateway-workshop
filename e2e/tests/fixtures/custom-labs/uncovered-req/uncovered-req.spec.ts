// custom-labs/uncovered-req/uncovered-req.md
// @req R1 The first page loads
// @req R2 The second page loads
import { expect, test } from '@playwright/test';
import { lab } from '../lib/lab';

const { go, shot } = lab('custom', 'uncovered-req');

test('[R1] first page loads', async ({ page }) => {
  await go(page, '/');
  await shot(page, '01-a');
});

test('second page loads', async ({ page }) => {
  await go(page, '/llm/models');
  await shot(page, '02-b');
  await expect(page.locator('main')).toBeVisible();
});
