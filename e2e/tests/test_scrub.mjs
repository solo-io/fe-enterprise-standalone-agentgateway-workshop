import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText, userValuesFromChanges } from '../lib/scrub.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../lib/scrub.mjs');
const fixtureChanges = join(here, 'fixtures/contribute/CHANGES.md');

const hits = (text, allow = [], userValues = []) => scanText(text, allow, userValues).map(([, r, m]) => [r, m]);
const has = (list, rule, match) => list.some(([r, m]) => r === rule && m === match);
const rules = (text) => hits(text).map(([r]) => r);

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scrub-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true }); }
}
function cli(args, cwd) {
  const p = spawnSync('node', [script, ...args], { cwd, encoding: 'utf8' });
  return { code: p.status, out: p.stdout, err: p.stderr };
}

test('ipv4 in a URL', () => {
  assert.ok(has(hits('issuer: http://172.22.255.253:8080/realms/x'), 'ipv4', '172.22.255.253'));
});
test('a version is not an ipv4 or hostname', () => {
  assert.deepEqual(hits('chart v2026.10.1 and 2.3.2'), []);
});
test('hostname in a markdown link', () => {
  assert.ok(has(hits('see [portal](https://corp.acme-internal.net/x)'), 'hostname', 'corp.acme-internal.net'));
});
test('allowlisted hosts are clean, including the defaults added here', () => {
  const text = 'keycloak.keycloak.svc.cluster.local api.openai.com quay.io/keycloak/keycloak:26.0 docs.solo.io '
    + 'localhost:15000 localhost:4000 localhost:4001 host.docker.internal mcr.microsoft.com us-docker.pkg.dev';
  assert.deepEqual(hits(text), []);
});
test('py and ts file names are not hostnames', () => {
  assert.deepEqual(hits('run main.py and app.ts'), []);
});
test('filenames are not hostnames', () => {
  assert.deepEqual(hits('open labs/llm/001-base.md and demo.spec.ts and CHANGES.md'), []);
});
test('email outside example.com fires, example.com does not', () => {
  assert.ok(has(hits('contact alex@acme.io'), 'email', 'alex@acme.io'));
  assert.deepEqual(hits('gold-user@example.com'), []);
});
test('bearer fires, and prose after Bearer does not', () => {
  assert.ok(has(hits("-H 'Authorization: Bearer abc.def.ghi'"), 'bearer', 'Bearer abc.def.ghi'));
  assert.deepEqual(hits('send a Bearer token'), []);
});
test('secret prefixes fire, including agw_sk_', () => {
  assert.deepEqual(rules('key sk-live-12345 and eyJhbGciOi'), ['secret-prefix', 'secret-prefix']);
  assert.ok(has(hits('key: agw_sk_abc123DEF'), 'secret-prefix', 'agw_sk_abc123DEF'));
});
test('github, slack and google tokens fire', () => {
  // Built by concatenation so the test file itself holds no token-shaped literal.
  const tokens = ['gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0', 'xo' + 'xb-' + '1234567890-abcdefABCDEF',
    'github' + '_pat_' + '11ABCDEFG0123456789', 'AI' + 'za' + 'SyA1b2C3d4E5f6G7h8'];
  for (const t of tokens) assert.ok(has(hits(`token: ${t}`), 'secret-prefix', t), t);
});
test('base64 blob fires, but not on an image: line', () => {
  const blob = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9w';
  assert.ok(has(hits(`n: ${blob}`), 'base64-blob', blob));
  assert.deepEqual(hits(`image: registry/${blob}`), []);
});
test('cloud ids', () => {
  assert.deepEqual(
    rules('arn:aws:iam::123456789012:role/x projects/my-proj-123/ 3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
    ['cloud-id', 'cloud-id', 'cloud-id']);
});
test('user values match whole words, case-insensitively', () => {
  assert.ok(has(hits('the Acme Payments team', [], ['Acme Payments']), 'user-value', 'Acme Payments'));
  assert.deepEqual(hits('an explanation', [], ['plan']), []);
  assert.ok(has(hits('the plan claim', [], ['plan']), 'user-value', 'plan'));
});
test('--allow globs extend the allowlist', () => {
  assert.deepEqual(hits('host corp.acme-internal.net', ['*.acme-internal.net']), []);
});
test('dotted identifiers are not hostnames', () => {
  assert.deepEqual(hits('jwt.plan chat.completion access.token.claim org.keycloak.userprofile.UserProfileProvider'), []);
});
test('tld rule', () => {
  assert.ok(has(hits('host corp.acme.nl'), 'hostname', 'corp.acme.nl'));
  assert.ok(has(hits('host bank.acme.systems'), 'hostname', 'bank.acme.systems'));
  assert.ok(has(hits('host corp.acme.NET'), 'hostname', 'corp.acme.NET'));
});
test('ipv6', () => {
  assert.ok(has(hits('addr fe80::1 here'), 'ipv6', 'fe80::1'));
});
test('hits are deduplicated per line', () => {
  assert.equal(scanText('10.1.2.3 and 10.1.2.3', [], []).length, 1);
});

test('--from-changes finds a backticked table value and a capitalised phrase', () => withTmp((tmp) => {
  const lab = join(tmp, 'lab.md');
  writeFileSync(lab, 'line one\nthe acme-backend route for Acme Payments\n');
  const r = cli(['--from-changes', fixtureChanges, lab], tmp);
  assert.equal(r.code, 0);
  assert.match(r.out, /lab\.md:2\tuser-value\tacme-backend/);
  assert.match(r.out, /lab\.md:2\tuser-value\tAcme Payments/);
}));
test('--from-changes reads a Configuration heading too', () => withTmp((tmp) => {
  const changes = join(tmp, 'CHANGES.md');
  writeFileSync(changes, '## Configuration\n\n| Kind | Name |\n|--|--|\n| Secret | `acme-key` |\n');
  assert.deepEqual(userValuesFromChanges(changes), ['acme-key']);
}));
test('value extraction skips generic, numeric and short-path values', () => withTmp((tmp) => {
  const changes = join(tmp, 'CHANGES.md');
  writeFileSync(changes, '## Requirements\n\n| Kind | Name |\n|--|--|\n'
    + '| Secret | `12345` |\n| Secret | `/openai` |\n| Secret | `/acme-payments` |\n'
    + '| Secret | `OPENAI_API_KEY` |\n| Secret | `KUBECONFIG` |\n| Secret | `gold-user` |\n');
  assert.deepEqual(userValuesFromChanges(changes), ['/acme-payments', 'gold-user']);
}));
test('--summary collapses duplicates', () => withTmp((tmp) => {
  writeFileSync(join(tmp, 'lab.md'), 'ip 10.1.2.3\nagain 10.1.2.3 and 10.9.9.9\n');
  const r = cli(['--summary', 'lab.md'], tmp);
  assert.deepEqual(r.out.split('\n').filter(Boolean), ['2\tipv4\t10.1.2.3\tlab.md:1', '1\tipv4\t10.9.9.9\tlab.md:2']);
}));
test('output format is path:line, rule, match, and a directory is walked', () => withTmp((tmp) => {
  writeFileSync(join(tmp, 'a.md'), 'x\nhost 10.1.2.3\n');
  const r = cli(['.'], tmp);
  assert.equal(r.code, 0);
  assert.equal(r.out, 'a.md:2\tipv4\t10.1.2.3\n');
}));
test('a binary file is skipped', () => withTmp((tmp) => {
  writeFileSync(join(tmp, 'b.png'), Buffer.from('\0 10.1.2.3'));
  const r = cli(['b.png'], tmp);
  assert.deepEqual([r.code, r.out], [0, '']);
}));
test('a patch file is scanned', () => withTmp((tmp) => {
  writeFileSync(join(tmp, 'staged.patch'), 'diff --git a/x.md b/x.md\n+issuer: http://10.1.2.3/realms/x\n');
  const r = cli(['--summary', 'staged.patch'], tmp);
  assert.deepEqual(r.out.split('\n').filter(Boolean), ['1\tipv4\t10.1.2.3\tstaged.patch:2']);
}));
test('a ts spec file name is not a hostname', () => withTmp((tmp) => {
  copyFileSync(join(here, 'fixtures/contribute/stage/demo.spec.ts'), join(tmp, 'demo.spec.ts'));
  const r = cli(['demo.spec.ts'], tmp);
  assert.deepEqual([r.code, r.out], [0, '']);
}));
test('a missing path exits 2', () => {
  assert.equal(cli(['/nonexistent/x.md']).code, 2);
});
test('a missing --from-changes file exits 2', () => withTmp((tmp) => {
  writeFileSync(join(tmp, 'a.md'), 'x\n');
  assert.equal(cli(['--from-changes', join(tmp, 'nope.md'), join(tmp, 'a.md')]).code, 2);
}));
