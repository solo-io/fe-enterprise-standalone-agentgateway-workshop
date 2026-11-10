// Reads the tests out of a Playwright JSON report. Shared by outcome.mjs and report.mjs.
// A test is skipped when every result is skipped, and failed when any result is failed, timedOut or interrupted.
// A missing or unreadable file gives no tests (the run died before Playwright wrote a report).
import { readFileSync } from 'node:fs';

const BAD = new Set(['failed', 'timedOut', 'interrupted']);

function* specsOf(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specsOf(child);
}

// [{ title, status: 'passed'|'failed'|'skipped', reason }], reason from a skip annotation or ''.
export function readTests(file) {
  let report = { suites: [] };
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // keep the empty report
  }
  const out = [];
  for (const suite of report.suites ?? []) {
    for (const spec of specsOf(suite)) {
      for (const t of spec.tests ?? []) {
        const statuses = (t.results ?? []).map((r) => r.status);
        let status = 'passed';
        if (statuses.some((s) => BAD.has(s))) status = 'failed';
        else if (statuses.length > 0 && statuses.every((s) => s === 'skipped')) status = 'skipped';
        const skip = (t.annotations ?? []).find((a) => a.type === 'skip' && a.description);
        out.push({ title: spec.title, status, reason: status === 'skipped' ? (skip?.description ?? '') : '' });
      }
    }
  }
  return out;
}

export function summarize(tests) {
  const failed = tests.filter((t) => t.status === 'failed');
  return {
    tests: tests.length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    failed: failed.length,
    firstFailure: failed.length ? failed[0].title : '-',
  };
}
