import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, 'fixtures/report');
const script = join(here, '../lib/report.mjs');
const common = ['--work', join(fx, 'work-a'), '--env-json', join(fx, 'env.json'), '--session', join(fx, 'session.jsonl'),
  '--compose', join(fx, 'compose.yml'), '--stamp', '20261109-101500'];

function build(extra, out) {
  const stdout = execFileSync('node', [script, 'build', ...common, '--out', out, ...extra], { encoding: 'utf8' });
  return stdout.trim().split('\n');
}
function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'report-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true }); }
}

test('track build writes both files and the title', () => withTmp((out) => {
  const [md, json] = build(['--track', 'llm'], out);
  assert.equal(md, join(out, '20261109-101500-standalone-llm.md'));
  assert.equal(json, join(out, '20261109-101500-standalone-llm.json'));
  const text = readFileSync(md, 'utf8');
  assert.match(text, /^# Agentgateway standalone llm report$/m);
  assert.ok(existsSync(json));
  assert.equal(JSON.parse(readFileSync(json, 'utf8')).results.length, 5);
}));

test('results table has one row per llm outcome, 001 first, no mcp row', () => withTmp((out) => {
  const text = readFileSync(build(['--track', 'llm'], out)[0], 'utf8');
  assert.match(text, /\| Lab \| Status \| Duration \| Notes \|/);
  const rows = text.split('\n').filter((l) => /^\| (001|llm\/)/.test(l)).map((l) => l.split('|')[1].trim());
  assert.deepEqual(rows, ['001', 'llm/bad', 'llm/cfg', 'llm/skip', 'llm/x']);
  assert.ok(!text.includes('mcp/y'));
}));

test('statuses render skipped, config mismatch, first failure and leftovers', () => withTmp((out) => {
  const text = readFileSync(build(['--track', 'llm'], out)[0], 'utf8');
  const row = (id) => text.split('\n').find((l) => l.startsWith(`| ${id} |`));
  assert.match(row('llm/skip'), /PASS \(1 tests skipped/);
  assert.match(row('llm/cfg'), /FAIL \(config did not return to base\)/);
  assert.match(row('llm/cfg'), /1 leftover project\(s\)/);
  assert.match(row('llm/bad'), /FAIL \(\[R2\] bob is denied\)/);
  assert.match(row('llm/x'), /\| PASS \|/);
}));

test('track all includes every track and no custom lab', () => withTmp((out) => {
  const json = JSON.parse(readFileSync(build(['--track', 'all'], out)[1], 'utf8'));
  const ids = json.results.map((r) => r.lab);
  assert.ok(ids.includes('mcp/y') && ids.includes('001'));
  assert.ok(!ids.some((i) => i.startsWith('custom/')));
}));

test('no key value appears, keys print present or missing', () => withTmp((out) => {
  const text = readFileSync(build(['--track', 'llm'], out)[0], 'utf8');
  assert.ok(!text.includes('sk-secret-123'));
  assert.match(text, /OPENAI_API_KEY: present/);
  assert.match(text, /ANTHROPIC_API_KEY: missing/);
  assert.match(text, /TYPESAFE_AI_API_KEY: missing/);
  assert.match(text, /2026\.10\.0/);
  assert.match(text, /Docker version 27\.3\.1/);
}));

test('decisions and failures come from the session log, leftovers from outcomes', () => withTmp((out) => {
  const text = readFileSync(build(['--track', 'llm'], out)[0], 'utf8');
  assert.match(text, /## Decisions[\s\S]*Used the mock provider[\s\S]*Skipped the TypeSafe lab/);
  assert.ok(!text.includes('mcp only decision'));
  assert.match(text, /## Failures[\s\S]*llm\/bad[\s\S]*Route returned 500/);
  assert.match(text, /## Leftovers[\s\S]*llm\/cfg[\s\S]*agw-e2e-llm-cfg/);
}));

const section = (text, name) => text.split(/^## /m).find((p) => p.startsWith(`${name}\n`)) ?? '';

test('missing session and env are recorded as not recorded', () => withTmp((out) => {
  const stdout = execFileSync('node', [script, 'build', '--work', join(fx, 'work-a'), '--env-json', join(out, 'none.json'),
    '--session', join(out, 'none.jsonl'), '--compose', join(fx, 'compose.yml'), '--out', out, '--track', 'llm',
    '--stamp', '20261109-101500'], { encoding: 'utf8' });
  const text = readFileSync(stdout.trim().split('\n')[0], 'utf8');
  assert.match(section(text, 'Environment'), /not recorded/);
  assert.match(section(text, 'Decisions'), /not recorded/);
  assert.match(section(text, 'Failures'), /not recorded/);
  const left = section(text, 'Leftovers');
  assert.match(left, /pre-existing projects: not recorded/);
  assert.match(left, /llm\/cfg: 1 leftover project\(s\)/);
  assert.ok(!left.includes('None.'));
}));

test('custom build has a requirements table', () => withTmp((out) => {
  const spec = join(here, 'fixtures/custom-labs/demo/demo.spec.ts');
  const [md, json] = build(['--custom', 'demo', '--spec', spec], out);
  assert.ok(md.includes('custom-demo'));
  const text = readFileSync(md, 'utf8');
  assert.match(text, /^# Agentgateway standalone custom lab report: demo$/m);
  assert.match(text, /\| Id \| Requirement \| Tests \| Status \|/);
  assert.match(text, /\| R1 \| The first page loads \| \[R1\] alice is allowed \| PASS \|/);
  assert.match(text, /\| R2 \| The second page loads \| \[R2\] bob is denied \| FAIL \|/);
  assert.match(text, /## Runs[\s\S]*First attempt/);
  assert.equal(JSON.parse(readFileSync(json, 'utf8')).results.length, 1);
  assert.ok(!text.includes('mcp only decision'));
}));

test('a requirement with no test is NOT RUN', () => withTmp((out) => {
  const spec = join(fx, 'r9.spec.ts');
  const [md] = build(['--custom', 'other', '--spec', spec], out);
  const text = readFileSync(md, 'utf8');
  assert.match(text, /\| R9 \| The ninth page loads \| - \| NOT RUN \|/);
  assert.match(text, /\| R1 \|.*\| PASS \|/);
}));

test('a requirement whose only test was skipped is NOT RUN', () => withTmp((out) => {
  const [md] = build(['--custom', 'skipper', '--spec', join(fx, 'r123.spec.ts')], out);
  const text = readFileSync(md, 'utf8');
  assert.match(text, /\| R3 \| Needs anthropic \| \[R3\] needs anthropic \| NOT RUN \|/);
  assert.match(text, /\| R1 \|.*\| PASS \|/);
}));

test('a name clash appends -1 then -2', () => withTmp((out) => {
  build(['--track', 'llm'], out);
  const [md1] = build(['--track', 'llm'], out);
  assert.equal(md1, join(out, '20261109-101500-standalone-llm-1.md'));
  const [md2, json2] = build(['--track', 'llm'], out);
  assert.equal(md2, join(out, '20261109-101500-standalone-llm-2.md'));
  assert.ok(json2.endsWith('-2.json'));
  assert.equal(readdirSync(out).length, 6);
}));

test('compare prints changed, added and removed rows', () => {
  const out = execFileSync('node', [script, 'compare', join(fx, 'a.json'), join(fx, 'b.json')], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.ok(lines.includes('llm/x: PASS -> FAIL'));
  assert.ok(lines.includes('added: llm/new'));
  assert.ok(lines.includes('removed: llm/gone'));
  assert.ok(!out.includes('llm/same'));
});

test('compare says no changes', () => {
  const out = execFileSync('node', [script, 'compare', join(fx, 'same.json'), join(fx, 'same.json')], { encoding: 'utf8' });
  assert.equal(out.trim(), 'no changes');
});

test('a bad command exits 64', () => {
  assert.equal(spawnSync('node', [script, 'nope']).status, 64);
});

test('events written by session-log.sh with the - lab key reach Decisions', () => withTmp((out) => {
  const root = mkdtempSync(join(tmpdir(), 'wr-'));
  try {
    const env = { ...process.env, E2E_WORK_ROOT: root };
    const log = join(here, '../lib/session-log.sh');
    execFileSync('bash', [log, 'add', 'decision', '-', 'Global one from the writer'], { env });
    execFileSync('bash', [log, 'add', 'decision', '-', 'Global two from the writer'], { env });
    const stdout = execFileSync('node', [script, 'build', '--work', join(fx, 'work-a'), '--env-json', join(fx, 'env.json'),
      '--session', join(root, 'session.jsonl'), '--out', out, '--track', 'llm', '--stamp', '20261109-101500'], { encoding: 'utf8' });
    const dec = section(readFileSync(stdout.trim().split('\n')[0], 'utf8'), 'Decisions');
    assert.match(dec, /Global one from the writer/);
    assert.match(dec, /Global two from the writer/);
  } finally { rmSync(root, { recursive: true }); }
}));

test('planned ids with no outcome render as NOT RUN rows', () => withTmp((out) => {
  const planned = join(out, 'planned.txt');
  writeFileSync(planned, '001\nllm/x\nllm/never-ran\n');
  const text = readFileSync(build(['--track', 'llm', '--planned', planned], out)[0], 'utf8');
  const rows = text.split('\n').filter((l) => l.includes('NOT RUN'));
  assert.deepEqual(rows, ['| llm/never-ran | NOT RUN | - | no outcome recorded |']);
}));

test('projects-now empty with env.json listing one shows both labels', () => withTmp((out) => {
  const now = join(out, 'now.txt');
  writeFileSync(now, '');
  const left = section(readFileSync(build(['--track', 'llm', '--projects-now', now], out)[0], 'utf8'), 'Leftovers');
  assert.match(left, /at session start: agw-e2e-llm-cfg/);
  assert.match(left, /now: none/);
}));

test('projects-now absent says not recorded', () => withTmp((out) => {
  const left = section(readFileSync(build(['--track', 'llm'], out)[0], 'utf8'), 'Leftovers');
  assert.match(left, /now: not recorded/);
}));

// A copy of work-a that a test can change.
function workCopy(dir) {
  const work = join(dir, 'work');
  cpSync(join(fx, 'work-a'), work, { recursive: true });
  return work;
}
function buildIn(work, out, extra, session = join(fx, 'session.jsonl')) {
  const stdout = execFileSync('node', [script, 'build', '--work', work, '--env-json', join(fx, 'env.json'), '--session', session,
    '--compose', join(fx, 'compose.yml'), '--stamp', '20261109-101500', '--out', out, ...extra], { encoding: 'utf8' });
  return readFileSync(stdout.trim().split('\n')[0], 'utf8');
}

test('a config mismatch names the fixture the spec expected', () => withTmp((dir) => {
  const work = workCopy(dir);
  writeFileSync(join(work, 'llm-cfg', 'outcome'),
    'status=fail rc=2 duration=20 tests=3 skipped=0 fixture=mcp-start expect=mcp-start profiles=- leftover=0 config_mismatch=1 reason=config did not return to mcp-start\n');
  const text = buildIn(work, dir, ['--track', 'llm']);
  const row = text.split('\n').find((l) => l.startsWith('| llm/cfg |'));
  assert.match(row, /FAIL \(config did not return to mcp-start\)/);
  assert.ok(!row.includes('return to base'));
}));

test('a failure logged for a planned lab with no outcome reaches Failures', () => withTmp((dir) => {
  const session = join(dir, 'session.jsonl');
  writeFileSync(session, `${JSON.stringify({ ts: '2026-11-09T10:09:00Z', kind: 'failure', lab: 'llm/died', text: 'setup copy failed before the run' })}\n`);
  const planned = join(dir, 'planned.txt');
  writeFileSync(planned, '001\nllm/died\n');
  const text = buildIn(join(fx, 'work-a'), dir, ['--track', 'llm', '--planned', planned], session);
  assert.match(section(text, 'Failures'), /\[llm\/died\] setup copy failed before the run/);
  assert.match(text, /\| llm\/died \| NOT RUN \|/);
}));

test('outcomes older than session-start are left out', () => withTmp((dir) => {
  const work = workCopy(dir);
  const old = new Date(Date.now() - 3600_000);
  for (const d of readdirSync(work)) {
    if (existsSync(join(work, d, 'outcome'))) utimesSync(join(work, d, 'outcome'), old, old);
  }
  writeFileSync(join(work, 'session-start'), '');
  writeFileSync(join(work, 'llm-x', 'outcome'), 'status=pass rc=0 duration=5 tests=3 skipped=0 fixture=base expect=base profiles=- leftover=0\n');
  const planned = join(dir, 'planned.txt');
  writeFileSync(planned, '001\nllm/x\nllm/bad\n');
  const text = buildIn(work, dir, ['--track', 'llm', '--planned', planned]);
  const rows = text.split('\n').filter((l) => /^\| (001|llm\/)/.test(l));
  assert.deepEqual(rows.map((l) => l.split('|')[1].trim()), ['001', 'llm/x', 'llm/bad']);
  assert.match(rows[0], /NOT RUN.*earlier session/);
  assert.match(rows[1], /\| PASS \|/);
  assert.match(rows[2], /NOT RUN.*earlier session/);
  assert.ok(!text.includes('llm/cfg'));
}));

test('without session-start every outcome counts', () => withTmp((dir) => {
  const work = workCopy(dir);
  const old = new Date(Date.now() - 3600_000);
  utimesSync(join(work, 'llm-cfg', 'outcome'), old, old);
  const text = buildIn(work, dir, ['--track', 'llm']);
  assert.ok(text.includes('| llm/cfg |'));
}));
