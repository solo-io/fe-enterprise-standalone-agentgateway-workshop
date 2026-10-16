// Compares the gateway config a lab left behind with the fixture it must end in.
// Usage: node lib/compare.mjs <actual.yaml> <expected.yaml>
import { readFileSync } from 'node:fs';
import { normalize, parseConfig } from './normalize.mjs';

const [actualPath, expectedPath] = process.argv.slice(2);
const actual = normalize(parseConfig(readFileSync(actualPath, 'utf8')));
const expected = normalize(parseConfig(readFileSync(expectedPath, 'utf8')));
const a = JSON.stringify(actual, null, 2);
const e = JSON.stringify(expected, null, 2);
if (a !== e) {
  console.error(`config after cleanup does not match ${expectedPath}`);
  console.error('--- expected\n' + e + '\n--- actual\n' + a);
  process.exit(2);
}
console.log(`config matches ${expectedPath}`);
