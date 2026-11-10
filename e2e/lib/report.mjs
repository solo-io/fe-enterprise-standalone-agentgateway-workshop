// Builds the evaluation report from a run's work dir, and compares two reports.
//
//   node lib/report.mjs build --work <dir> --env-json <file> --session <file> --out <dir>
//        (--track <t> | --custom <name>) [--compose <file>] [--readme <file>] [--spec <file>] [--stamp <YYYYMMDD-HHMMSS>]
//   node lib/report.mjs compare <a.json> <b.json>
//
// build writes <stamp>-standalone-<track>.md/.json (or <stamp>-standalone-custom-<name>.md/.json) into --out and prints
// both paths. A missing env.json or session.jsonl is not an error; those sections say "not recorded".
// Key values never reach the report: env.json holds statuses, and only "ok" and "rejected" print as "present".
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readTests, summarize } from './playwright-tests.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TRACKS = ['llm', 'mcp', 'platform'];

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}
function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// "status=pass rc=0 ... leftover=0 [config_mismatch=1] [reason=text]" -> object; reason is last and may hold spaces.
export function parseOutcome(line) {
  const at = line.indexOf(' reason=');
  const reason = at >= 0 ? line.slice(at + ' reason='.length).trim() : '';
  const fields = {};
  for (const tok of (at >= 0 ? line.slice(0, at) : line).trim().split(/\s+/)) {
    const eq = tok.indexOf('=');
    if (eq > 0) fields[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return { ...fields, reason };
}

// Outcome dirs are the id with / as -: 001, llm-virtual-api-keys. custom/<name> is nested.
function idOfDir(name) {
  for (const t of TRACKS) if (name.startsWith(`${t}-`)) return `${t}/${name.slice(t.length + 1)}`;
  return name;
}

function listDirs(dir) {
  try { return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort(); } catch { return []; }
}

function loadRun(dir, id) {
  const line = readText(join(dir, 'outcome'));
  if (line === null) return null;
  const o = parseOutcome(line.split('\n')[0]);
  const tests = readTests(join(dir, 'playwright.json'));
  return { id, o, tests };
}

function describe({ id, o, tests }) {
  const pass = o.status === 'pass';
  const leftover = Number(o.leftover ?? 0);
  const skipped = Number(o.skipped ?? 0);
  let text;
  if (pass) {
    text = 'PASS';
    if (skipped > 0) {
      const why = tests.find((t) => t.status === 'skipped' && t.reason)?.reason;
      text = `PASS (${skipped} tests skipped${why ? `: ${why}` : ''})`;
    }
  } else if (o.config_mismatch === '1') text = 'FAIL (config did not return to base)';
  else if (o.rc === '1' && o.reason) text = `FAIL (${o.reason})`;
  else text = `FAIL (${o.reason || `rc=${o.rc}`})`;
  const notes = [];
  if (o.reason) notes.push(o.reason);
  if (leftover > 0) notes.push(`${leftover} leftover project(s)`);
  return {
    lab: id,
    status: pass ? 'PASS' : 'FAIL',
    status_text: text,
    duration: Number(o.duration ?? 0),
    tests: Number(o.tests ?? 0),
    skipped,
    leftover,
    notes: notes.join('; '),
  };
}

function loadRuns(work, opts) {
  const runs = [];
  if (opts.custom) {
    const run = loadRun(join(work, 'custom', opts.custom), `custom/${opts.custom}`);
    if (run) runs.push(run);
    return runs;
  }
  for (const name of listDirs(work)) {
    if (name === 'custom') continue;
    const id = idOfDir(name);
    const track = id.includes('/') ? id.split('/')[0] : null;
    const wanted = opts.track === 'all'
      || track === opts.track
      || (id === '001' && opts.track === 'llm');
    if (!wanted) continue;
    const run = loadRun(join(work, name), id);
    if (run) runs.push(run);
  }
  runs.sort((a, b) => (a.id === '001' ? -1 : b.id === '001' ? 1 : a.id.localeCompare(b.id)));
  return runs;
}

function readEvents(file) {
  const text = readText(file);
  if (text === null) return null;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return out;
}

function environment(envFile, composeFile) {
  const env = readJson(envFile);
  let image = null;
  const compose = composeFile ? readText(composeFile) : null;
  if (compose !== null) {
    try {
      const ref = parseYaml(compose)?.services?.agentgateway?.image;
      if (typeof ref === 'string') image = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
    } catch { /* leave it unrecorded */ }
  }
  if (!env) return { recorded: false, gateway_image_tag: image };
  const keys = {};
  for (const [name, status] of Object.entries(env.keys ?? {})) {
    keys[name] = status === 'ok' || status === 'rejected' ? 'present' : 'missing';
  }
  return {
    recorded: true,
    gateway_image_tag: image,
    docker: env.docker ?? null,
    compose: env.compose ?? null,
    keys,
    leftover_projects: Array.isArray(env.leftover_projects) ? env.leftover_projects : [],
  };
}

function readSpecRequirements(specFile) {
  const text = readText(specFile);
  if (text === null) return [];
  const out = [];
  for (const m of text.matchAll(/^\s*\/\/\s*@req\s+(R\d+)\s+(.*?)\s*$/gm)) out.push({ id: m[1], text: m[2] });
  return out;
}

function requirements(specFile, tests) {
  return readSpecRequirements(specFile).map((r) => {
    const mine = tests.filter((t) => [...t.title.matchAll(/\[(R\d+)\]/g)].some((m) => m[1] === r.id));
    let status = 'NOT RUN';
    if (mine.length > 0) status = mine.some((t) => t.status === 'failed') ? 'FAIL' : 'PASS';
    return { id: r.id, requirement: r.text, tests: mine.map((t) => t.title), status };
  });
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
];

function render(rep) {
  const L = [`# ${rep.title}`, '', `Generated ${rep.generated}`, ''];
  L.push('## Environment', '');
  const e = rep.environment;
  L.push(`- Gateway image tag: ${e.gateway_image_tag ?? 'not recorded'}`);
  if (!e.recorded) L.push('- Docker, Compose and keys: not recorded');
  else {
    L.push(`- Docker: ${e.docker ?? 'not recorded'}`, `- Compose: ${e.compose ?? 'not recorded'}`);
    for (const [k, v] of Object.entries(e.keys)) L.push(`- ${k}: ${v}`);
  }
  L.push('', '## Results', '');
  if (rep.results.length === 0) L.push('No outcomes found in the work dir.');
  else L.push(...table(['Lab', 'Status', 'Duration', 'Notes'], rep.results.map((r) => [r.lab, r.status_text, `${r.duration}s`, r.notes])));
  if (rep.requirements) {
    L.push('', '## Requirements', '');
    if (rep.requirements.length === 0) L.push('No @req lines found in the spec.');
    else L.push(...table(['Id', 'Requirement', 'Tests', 'Status'],
      rep.requirements.map((r) => [r.id, r.requirement, r.tests.join('; ') || '-', r.status])));
  }
  const events = (title, list) => {
    L.push('', `## ${title}`, '');
    if (list === null) L.push('not recorded');
    else if (list.length === 0) L.push('None.');
    else for (const ev of list) L.push(`- ${ev.ts} ${ev.lab && ev.lab !== '-' ? `[${ev.lab}] ` : ''}${ev.kind === 'decision' ? '' : `${ev.kind}: `}${ev.text}`);
  };
  events('Decisions', rep.decisions);
  if (rep.runs) events('Runs', rep.runs);
  L.push('', '## Failures', '');
  const fails = rep.results.filter((r) => r.status === 'FAIL').map((r) => `- ${r.lab}: ${r.status_text}`);
  if (rep.failures === null && fails.length === 0) L.push('not recorded');
  else if ((rep.failures ?? []).length + fails.length === 0) L.push('None.');
  else {
    L.push(...fails);
    for (const ev of rep.failures ?? []) L.push(`- ${ev.ts} ${ev.lab && ev.lab !== '-' ? `[${ev.lab}] ` : ''}${ev.text}`);
  }
  L.push('', '## Leftovers', '');
  const left = rep.results.filter((r) => r.leftover > 0).map((r) => `- ${r.lab}: ${r.leftover} leftover project(s)`);
  for (const p of rep.leftover_projects) left.push(`- project still listed: ${p}`);
  L.push(...(left.length ? left : ['None.']));
  return L.join('\n') + '\n';
}

function pickNames(out, base) {
  let suffix = '';
  for (let n = 1; existsSync(join(out, `${base}${suffix}.md`)) || existsSync(join(out, `${base}${suffix}.json`)); n++) suffix = `-${n}`;
  return [join(out, `${base}${suffix}.md`), join(out, `${base}${suffix}.json`)];
}

function utcStamp(d = new Date()) {
  return d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--') || i + 1 >= argv.length) throw new Error(`bad argument: ${argv[i]}`);
    o[argv[i].slice(2)] = argv[++i];
  }
  return o;
}

function build(argv) {
  const a = args(argv);
  for (const k of ['work', 'env-json', 'session', 'out']) if (!a[k]) throw new Error(`missing --${k}`);
  if (!a.track === !a.custom) throw new Error('give exactly one of --track and --custom');
  if (a.track && ![...TRACKS, 'all'].includes(a.track)) throw new Error(`unknown track: ${a.track}`);
  const custom = a.custom;
  const label = custom ? `custom-${custom}` : a.track;
  const runs = loadRuns(a.work, { track: a.track, custom });
  const results = runs.map(describe);
  const env = environment(a['env-json'], a.compose);
  const events = readEvents(a.session);
  const ids = new Set(runs.map((r) => r.id));
  const mine = events === null ? null : events.filter((ev) => ev.lab === '-' || ids.has(ev.lab) || (custom && ev.lab === custom));
  const rep = {
    title: custom ? `Agentgateway standalone custom lab report: ${custom}` : `Agentgateway standalone ${a.track} report`,
    generated: new Date().toISOString(),
    track: a.track ?? null,
    custom: custom ?? null,
    environment: env,
    results,
    decisions: mine === null ? null : mine.filter((ev) => ['decision', 'deviation', 'question', 'answer'].includes(ev.kind)),
    failures: mine === null ? null : mine.filter((ev) => ev.kind === 'failure'),
    leftover_projects: env.leftover_projects ?? [],
  };
  if (custom) {
    rep.requirements = requirements(a.spec ?? join(REPO, 'custom-labs', custom, `${custom}.spec.ts`), runs[0]?.tests ?? []);
    rep.runs = mine === null ? null : mine.filter((ev) => ev.kind === 'run');
  }
  mkdirSync(a.out, { recursive: true });
  const [md, json] = pickNames(a.out, `${a.stamp ?? utcStamp()}-standalone-${label}`);
  writeFileSync(md, render(rep));
  writeFileSync(json, JSON.stringify(rep, null, 2) + '\n');
  console.log(md);
  console.log(json);
}

function compare(files) {
  if (files.length !== 2) throw new Error('usage: compare <a.json> <b.json>');
  const load = (f) => {
    const j = readJson(f);
    if (!j) throw new Error(`cannot read ${f}`);
    return new Map((j.results ?? []).map((r) => [r.lab, r.status]));
  };
  const [a, b] = files.map(load);
  const lines = [];
  for (const [id, old] of a) {
    if (!b.has(id)) lines.push(`removed: ${id}`);
    else if (b.get(id) !== old) lines.push(`${id}: ${old} -> ${b.get(id)}`);
  }
  for (const id of b.keys()) if (!a.has(id)) lines.push(`added: ${id}`);
  console.log(lines.length ? lines.join('\n') : 'no changes');
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'build') build(rest);
  else if (cmd === 'compare') compare(rest);
  else { console.error('usage: report.mjs build ... | compare <a.json> <b.json>'); process.exit(64); }
} catch (err) {
  console.error(`report.mjs: ${err.message}`);
  process.exit(64);
}
