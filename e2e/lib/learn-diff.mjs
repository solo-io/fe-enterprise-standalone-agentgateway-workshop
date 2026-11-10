// Shows how the learning gateway's config changed while adapt drove it (run-e2e.sh --learn <name> --diff).
// Usage: node lib/learn-diff.mjs <config.before.yaml> <config.after.yaml>
// Exit 0 when they match, 2 when they differ, 1 on an error. The match test is compare.mjs's (configDiff):
// UI metadata is ignored, and an empty value counts as absent except a top-level key left empty.
// A difference prints one line per changed path:
//   + path: value      only in after
//   - path: value      only in before
//   ~ path: old -> new changed
import { readFileSync } from 'node:fs';
import { configDiff, normalize, parseConfig } from './normalize.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const show = (v) => JSON.stringify(v);

// Walks two normalized values; maps recurse by key, anything else compares as a whole.
export function pathDiff(before, after, path = '') {
  if (isObj(before) && isObj(after)) {
    const lines = [];
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      lines.push(...pathDiff(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return lines;
  }
  if (show(before) === show(after)) return [];
  if (before === undefined) return [`+ ${path}: ${show(after)}`];
  if (after === undefined) return [`- ${path}: ${show(before)}`];
  return [`~ ${path}: ${show(before)} -> ${show(after)}`];
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('usage: learn-diff.mjs <config.before.yaml> <config.after.yaml>');
  process.exit(1);
}
let before, after;
try {
  before = parseConfig(readFileSync(beforePath, 'utf8'));
  after = parseConfig(readFileSync(afterPath, 'utf8'));
} catch (err) {
  console.error(`learn-diff: ${err.message}`);
  process.exit(1);
}
const problems = configDiff(after, before);
if (problems.length === 0) {
  console.log('no config changes (UI metadata ignored)');
  process.exit(0);
}
console.log(`config changes from ${beforePath} to ${afterPath} (UI metadata ignored):`);
for (const line of pathDiff(normalize(before) ?? {}, normalize(after) ?? {})) console.log(line);
// Top-level keys left empty: normalize drops them, so the path diff alone would not show them.
for (const p of problems) if (!p.startsWith('--- expected')) console.log(`! ${p}`);
process.exit(2);
