// Reports candidate leaks in a custom lab before it is proposed upstream. Port of the workshop's scrub.py.
//
//   node lib/scrub.mjs [--allow GLOB]... [--from-changes CHANGES.md] [--summary] PATH...
//
// Walks the paths (directories recursively, binary files skipped) and prints one line per hit:
//   <relpath>:<line>\t<rule>\t<match>
// Exits 0 whatever it finds, 2 when a path (or the CHANGES.md) does not exist. --summary prints one line per
// distinct rule and match instead: count, rule, match, first location, sorted by rule then count descending.
//
// Rules: ipv4, ipv6, hostname, email, bearer, secret-prefix, base64-blob, cloud-id, user-value. The scan favours
// false positives over misses, so a human reads the output. --allow adds hostname globs to the built-in allowlist.
// --from-changes reads the "What the UI writes", "Configuration" and "Requirements" tables of a CHANGES.md and
// treats each backticked value and each run of 2+ capitalised words as a user-value to look for.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_ALLOW = [
  '*.svc', '*.svc.cluster.local', 'example.com', '*.example.com', 'localhost',
  'api.openai.com', 'quay.io', 'docker.io', 'ghcr.io', 'github.com',
  'docs.solo.io', 'agentgateway.dev', '*.kubernetes.io', '*.k8s.io', '*.solo.io',
  // The localhost:<port> entries are kept to match the plan; the hostname rule never sees them (no TLD after the colon).
  'localhost:15000', 'localhost:4000', 'localhost:4001', 'host.docker.internal',
  'mcr.microsoft.com', 'us-docker.pkg.dev',
];
// Last labels that mean "a file name", not a host. The Python list plus ts, because this repo ships ts specs.
const FILE_EXTS = new Set(['md', 'yaml', 'yml', 'json', 'sh', 'py', 'ts']);
const IGNORED_NAMESPACES = new Set(['agentgateway-system', 'default', 'keycloak']);
const GENERIC_VALUES = new Set(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SOLO_TRIAL_LICENSE_KEY', 'GATEWAY_IP', 'KUBECONFIG']);
// Last labels that count as a real TLD besides any 2-letter alphabetic one.
const KNOWN_TLDS = new Set(('com net org edu gov mil int biz info dev app cloud tech xyz ai io internal local '
  + 'corp lan home company group systems network online site store bank finance').split(' '));

// Regexes are the Python ones. Divergences: JavaScript \w is ASCII-only (Python's is Unicode), and
// re.IGNORECASE becomes the i flag; neither changes a match on ASCII lab text.
const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w])/g;
const G = '[0-9A-Fa-f]{1,4}';
const IPV6 = new RegExp(`(?<![\\w:])(?:(?:${G}:){7}${G}|(?:${G}(?::${G}){0,6})?::(?:${G}(?::${G}){0,6})?)(?![\\w:])`, 'g');
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const HOSTNAME = /(?<![\w.@-])[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const VERSION = /^v?\d+\.\d+(\.\d+)*$/;
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]{3,})/gi;
const SECRET_PREFIX = new RegExp(
  '\\bsk-[A-Za-z0-9][A-Za-z0-9_-]*|\\beyJ[A-Za-z0-9_.-]{3,}|\\bAKIA[A-Z0-9]{8,}'
  + '|\\bgh[pousr]_[A-Za-z0-9_]+|\\bgithub_pat_[A-Za-z0-9_]+|\\bxox[abposr]-[A-Za-z0-9-]+|\\bAIza[A-Za-z0-9_-]+'
  + '|\\bagw_sk_[A-Za-z0-9_-]+', 'g');
const BASE64 = /[A-Za-z0-9+/=]{40,}/g;
const KIND_IMAGE_LINE = /^\s*(?:-\s*)?(?:kind|image):/;
const ARN = /\barn:aws[\w-]*:[\w-]*:[\w-]*:\d*:[^\s'"`)\]]+/g;
const GCP_PROJECT = /\bprojects\/[a-z][a-z0-9-]{4,}\//g;
const GUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;

// fnmatch.fnmatch without the OS case rules: * ? [seq] [!seq], whole-string match.
function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') out += '.*';
    else if (c === '?') out += '.';
    else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) { out += '\\['; continue; }
      let set = glob.slice(i + 1, end);
      if (set[0] === '!') set = '^' + set.slice(1);
      out += `[${set.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else out += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 's');
}

function allowed(host, patterns) {
  const h = host.toLowerCase();
  return patterns.some((p) => globToRegex(p.toLowerCase()).test(h));
}

const isAlnum = (c) => /^[A-Za-z0-9]$/.test(c ?? '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Yields [rule, match] for one line, rules in documented order.
function* lineHits(line, allow, userValues) {
  const patterns = [...DEFAULT_ALLOW, ...allow];

  for (const m of line.matchAll(IPV4)) yield ['ipv4', m[0]];

  for (const m of line.matchAll(IPV6)) if (/[0-9A-Fa-f]/.test(m[0])) yield ['ipv6', m[0]];

  const emailSpans = [];
  const emails = [];
  for (const m of line.matchAll(EMAIL)) {
    emailSpans.push([m.index, m.index + m[0].length]);
    // An email is only clean under example.com (or a user --allow glob).
    if (!allowed(m[1], ['example.com', '*.example.com', ...allow])) emails.push(m[0]);
  }

  for (const m of line.matchAll(HOSTNAME)) {
    if (emailSpans.some(([s, e]) => s <= m.index && m.index < e)) continue;
    const token = m[0];
    const tld = token.split('.').pop();
    if (FILE_EXTS.has(tld.toLowerCase()) || VERSION.test(token)) continue;
    if (!(/^[A-Za-z]+$/.test(tld) && (tld.length === 2 || KNOWN_TLDS.has(tld.toLowerCase())))) continue;
    if (line[m.index + token.length] === '(') continue;
    if (allowed(token, patterns)) continue;
    yield ['hostname', token];
  }

  for (const e of emails) yield ['email', e];

  for (const m of line.matchAll(BEARER)) {
    if (/^[a-z]+$/.test(m[1]) && m[1].length < 10) continue; // prose such as "Bearer token"
    yield ['bearer', m[0]];
  }

  for (const m of line.matchAll(SECRET_PREFIX)) yield ['secret-prefix', m[0]];

  if (!KIND_IMAGE_LINE.test(line)) {
    for (const m of line.matchAll(BASE64)) if (new Set(m[0]).size >= 8) yield ['base64-blob', m[0]];
  }

  for (const rx of [ARN, GCP_PROJECT, GUID]) for (const m of line.matchAll(rx)) yield ['cloud-id', m[0]];

  for (const value of userValues) {
    const lead = isAlnum(value[0]) ? '(?<![A-Za-z0-9_])' : '';
    const trail = isAlnum(value[value.length - 1]) ? '(?![A-Za-z0-9_])' : '';
    if (new RegExp(lead + escapeRe(value) + trail, 'i').test(line)) yield ['user-value', value];
  }
}

// Returns [lineNo, rule, match] tuples, deduplicated per line.
export function scanText(text, allow, userValues) {
  const out = [];
  // Python splitlines also splits on \r, \f, \v and the Unicode line separators; \r?\n covers lab text.
  text.split(/\r\n|\n|\r/).forEach((line, i) => {
    const seen = new Set();
    for (const [rule, match] of lineHits(line, allow, userValues)) {
      const key = `${rule}\0${match}`;
      if (!seen.has(key)) { seen.add(key); out.push([i + 1, rule, match]); }
    }
  });
  // A trailing newline leaves one empty last element, which cannot hit anything.
  return out;
}

// Candidate user-specific values from the "What the UI writes", "Configuration" and "Requirements" tables.
export function userValuesFromChanges(path) {
  const lines = readFileSync(path, 'utf8').split(/\r\n|\n|\r/);
  const rows = [];
  let section = '';
  lines.forEach((line, i) => {
    if (line.startsWith('#')) { section = line.replace(/^#+/, '').trim().toLowerCase(); return; }
    if (!line.trimStart().startsWith('|')) return;
    if (!(section.includes('configuration') || section.includes('what the ui writes') || section.includes('requirements'))) return;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c) || !c)) return;
    const next = lines[i + 1] ?? '';
    if (/^\s*\|[\s:|-]+\|?\s*$/.test(next) && next.includes('-')) return; // header row
    rows.push([section, cells]);
  });
  const kinds = new Set();
  for (const [s, cells] of rows) {
    if ((s.includes('configuration') || s.includes('what the ui writes')) && cells.length) kinds.add(cells[0]);
  }
  const values = [];
  for (const [, cells] of rows) {
    for (const cell of cells) {
      for (const m of cell.matchAll(/`([^`]+)`/g)) values.push(m[1].trim());
      const stripped = cell.replace(/`[^`]*`/g, ' ');
      for (const m of stripped.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)) values.push(m[0]);
    }
  }
  const out = [];
  for (const v of values) {
    if (v.length < 4 || IGNORED_NAMESPACES.has(v) || kinds.has(v)) continue;
    if (/^[A-Z][A-Za-z0-9]*$/.test(v)) continue; // kind-like name such as HTTPRoute
    if (GENERIC_VALUES.has(v) || /^\d+$/.test(v)) continue;
    if (/^\/[a-z]{1,12}$/.test(v)) continue; // a short single path segment such as /openai
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function isBinary(path) {
  return readFileSync(path).subarray(0, 1024).includes(0);
}

// Files of a directory first (sorted), then its subdirectories (sorted), like os.walk; .git is skipped.
function* walk(paths) {
  for (const p of paths) {
    if (statSync(p).isDirectory()) yield* walkDir(p);
    else yield p;
  }
}
function* walkDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) if (!e.isDirectory()) yield join(dir, e.name);
  for (const e of entries) if (e.isDirectory() && e.name !== '.git') yield* walkDir(join(dir, e.name));
}

export function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true,
      options: { allow: { type: 'string', multiple: true, default: [] }, 'from-changes': { type: 'string' }, summary: { type: 'boolean', default: false } },
    });
  } catch (e) {
    process.stderr.write(`scrub: ${e.message}\n`);
    return 2;
  }
  const { values: opts, positionals: paths } = parsed;
  if (!paths.length) { process.stderr.write('scrub: at least one PATH is required\n'); return 2; }

  const missing = paths.filter((p) => !existsSync(p));
  if (opts['from-changes'] && !(existsSync(opts['from-changes']) && statSync(opts['from-changes']).isFile())) missing.push(opts['from-changes']);
  if (missing.length) {
    for (const p of missing) process.stderr.write(`scrub: no such path: ${p}\n`);
    return 2;
  }

  const userValues = opts['from-changes'] ? userValuesFromChanges(opts['from-changes']) : [];
  const summary = new Map();
  const lines = [];
  for (const path of walk(paths)) {
    let text;
    try {
      if (isBinary(path)) continue;
      text = readFileSync(path, 'utf8');
    } catch (e) {
      process.stderr.write(`scrub: cannot read ${path}: ${e.message}\n`);
      continue;
    }
    const rel = relative(process.cwd(), resolve(path));
    for (const [no, rule, match] of scanText(text, opts.allow, userValues)) {
      if (opts.summary) {
        const key = `${rule}\0${match}`;
        if (!summary.has(key)) summary.set(key, { rule, match, count: 0, first: `${rel}:${no}` });
        summary.get(key).count += 1;
      } else lines.push(`${rel}:${no}\t${rule}\t${match}`);
    }
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...summary.values()].sort((a, b) => cmp(a.rule, b.rule) || b.count - a.count || cmp(a.match, b.match));
  for (const s of sorted) lines.push(`${s.count}\t${s.rule}\t${s.match}\t${s.first}`);
  if (lines.length) process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
