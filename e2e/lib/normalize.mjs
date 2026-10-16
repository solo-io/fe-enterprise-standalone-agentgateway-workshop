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
