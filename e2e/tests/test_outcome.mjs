import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = (name) =>
  execFileSync('node', [join(here, '../lib/outcome.mjs'), join(here, 'fixtures/playwright', name)], { encoding: 'utf8' }).trim();

test('all passed', () => {
  assert.equal(run('pass.json'), 'tests=3 skipped=0 failed=0 first_failure=-');
});
test('a skipped test counts as skipped', () => {
  assert.equal(run('skipped.json'), 'tests=3 skipped=1 failed=0 first_failure=-');
});
test('a failed test names the first failure', () => {
  assert.equal(run('fail.json'), 'tests=2 skipped=0 failed=1 first_failure=[R2] bob is denied');
});
test('timedOut and interrupted count as failed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'outcome-'));
  try {
    const file = join(dir, 'p.json');
    const t = (title, status) => ({ title, tests: [{ results: [{ status }] }] });
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [t('slow one', 'timedOut'), t('cut one', 'interrupted'), t('fine', 'passed')] }] }));
    assert.equal(
      execFileSync('node', [join(here, '../lib/outcome.mjs'), file], { encoding: 'utf8' }).trim(),
      'tests=3 skipped=0 failed=2 first_failure=slow one');
  } finally { rmSync(dir, { recursive: true }); }
});
test('a test with no results did not run and is not a pass', async () => {
  const { readTests } = await import('../lib/playwright-tests.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'outcome-'));
  try {
    const file = join(dir, 'p.json');
    writeFileSync(file, JSON.stringify({ suites: [{ specs: [
      { title: '[R1] first', tests: [{ results: [{ status: 'interrupted' }] }] },
      { title: '[R2] never started', tests: [{ results: [] }] },
    ] }] }));
    assert.deepEqual(readTests(file).map((t) => [t.status, t.reason]), [['failed', ''], ['skipped', 'did not run']]);
    assert.equal(
      execFileSync('node', [join(here, '../lib/outcome.mjs'), file], { encoding: 'utf8' }).trim(),
      'tests=2 skipped=1 failed=1 first_failure=[R1] first');
  } finally { rmSync(dir, { recursive: true }); }
});
test('a missing file reports zero tests', () => {
  assert.equal(
    execFileSync('node', [join(here, '../lib/outcome.mjs'), join(here, 'fixtures/playwright/nope.json')], { encoding: 'utf8' }).trim(),
    'tests=0 skipped=0 failed=0 first_failure=-');
});
test('a title that looks like fields stays in first_failure', () => {
  assert.equal(run('trap.json'), 'tests=2 skipped=0 failed=1 first_failure=[R1] tests=9 skipped=3 trap');
});
