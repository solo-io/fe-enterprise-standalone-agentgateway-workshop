// Summarises a Playwright JSON report on one line:
//   node lib/outcome.mjs <playwright.json>
//   tests=<n> skipped=<n> failed=<n> first_failure=<title or ->
// A test is skipped when every result is skipped, and failed when any result is failed, timedOut or interrupted.
// A missing or unreadable file counts as zero tests (the run died before Playwright wrote a report).
import { readFileSync } from 'node:fs';

const BAD = new Set(['failed', 'timedOut', 'interrupted']);

function* specsOf(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specsOf(child);
}

let report = { suites: [] };
try {
  report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
} catch {
  // keep the empty report
}

let tests = 0, skipped = 0, failed = 0, firstFailure = '-';
for (const suite of report.suites ?? []) {
  for (const spec of specsOf(suite)) {
    for (const t of spec.tests ?? []) {
      const statuses = (t.results ?? []).map((r) => r.status);
      tests++;
      if (statuses.some((s) => BAD.has(s))) {
        failed++;
        if (firstFailure === '-') firstFailure = spec.title;
      } else if (statuses.length > 0 && statuses.every((s) => s === 'skipped')) {
        skipped++;
      }
    }
  }
}
console.log(`tests=${tests} skipped=${skipped} failed=${failed} first_failure=${firstFailure}`);
