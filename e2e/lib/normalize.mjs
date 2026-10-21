import { parse } from 'yaml';

// Metadata the UI generates on save; it differs on every run.
const VOLATILE = new Set(['agentgateway.dev/id', 'agentgateway.dev/createdAt', 'agentgateway.dev/keyHint']);

export function parseConfig(text) {
  return parse(text) ?? {};
}

// Sorts keys, drops volatile metadata, and treats empty maps and lists as absent,
// so "removed the last item" and "never added" compare equal.
export function normalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(normalize).filter((v) => v !== undefined);
    return items.length ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE.has(key)) continue;
      const v = normalize(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}

// Where a fixture lives: `base` is the reader's start config in setup/, the rest are in e2e/fixtures/.
export function fixturePath(root, name) {
  return name === 'base' ? `${root}/setup/config.yaml` : `${root}/e2e/fixtures/${name}.yaml`;
}

// Lists how the config a lab left behind differs from the one it must end in; empty means a match.
// Empty values count as absent, except for top-level keys: the reader sees those in Raw Configuration,
// and some change the UI (`gateways: {}` keeps Traffic on), so the lab's Clean up must remove them.
export function configDiff(actual, expected) {
  const problems = [];
  for (const [key, value] of Object.entries(actual ?? {})) {
    if (normalize(value) === undefined && !(key in (expected ?? {}))) {
      problems.push(`top-level \`${key}:\` is left empty; the lab's Clean up must delete that line in Raw Configuration`);
    }
  }
  const a = JSON.stringify(normalize(actual), null, 2);
  const e = JSON.stringify(normalize(expected), null, 2);
  if (a !== e) problems.push('--- expected\n' + e + '\n--- actual\n' + a);
  return problems;
}
