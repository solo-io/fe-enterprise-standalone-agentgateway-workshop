// Summarises a Playwright JSON report on one line:
//   node lib/outcome.mjs <playwright.json>
//   tests=<n> skipped=<n> failed=<n> first_failure=<title or ->
// The parsing lives in playwright-tests.mjs, which report.mjs shares.
import { readTests, summarize } from './playwright-tests.mjs';

const s = summarize(readTests(process.argv[2]));
console.log(`tests=${s.tests} skipped=${s.skipped} failed=${s.failed} first_failure=${s.firstFailure}`);
