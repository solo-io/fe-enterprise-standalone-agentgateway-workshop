// Compares the gateway config a lab left behind with the fixture it must end in.
// Usage: node lib/compare.mjs <actual.yaml> <expected.yaml>
import { readFileSync } from 'node:fs';
import { configDiff, parseConfig } from './normalize.mjs';

const [actualPath, expectedPath] = process.argv.slice(2);
const problems = configDiff(
  parseConfig(readFileSync(actualPath, 'utf8')),
  parseConfig(readFileSync(expectedPath, 'utf8')),
);
if (problems.length) {
  console.error(`config after cleanup does not match ${expectedPath}`);
  for (const p of problems) console.error(p);
  process.exit(2);
}
console.log(`config matches ${expectedPath}`);
