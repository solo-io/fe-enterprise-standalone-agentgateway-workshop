import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '../lib/promote.mjs');
const stageFixture = join(here, 'fixtures/contribute/stage');

// A temp repo with the track dirs, one shipped lab to link to, a README, and the fixture staged for "demo".
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'promote-'));
  for (const d of ['labs/llm', 'labs/mcp', 'labs/platform', 'e2e/labs/llm', 'e2e/lib']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'labs/llm/001-base.md'), '# Base\n');
  writeFileSync(join(root, 'README.md'), '# Workshop\n');
  cpSync(stageFixture, join(root, 'e2e/.work/contribute/demo/stage'), { recursive: true });
  return root;
}
function withRepo(fn) {
  const root = makeRepo();
  const ctx = {
    root,
    work: (rel = '') => join(root, 'e2e/.work/contribute/demo', rel),
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    exists: (rel) => existsSync(join(root, rel)),
    write(rel, text) { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); },
    run(args, { ok = true } = {}) {
      const p = spawnSync('node', [script, ...args, '--root', root], { encoding: 'utf8' });
      if (ok && p.status !== 0) assert.fail(`promote failed (${p.status}): ${p.stdout}${p.stderr}`);
      return { code: p.status, out: p.stdout, err: p.stderr };
    },
    // Every file outside the work dir, as { relpath: contents }.
    snapshot() {
      const out = {};
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          const r = relative(root, p);
          if (r === 'e2e/.work') continue;
          if (e.isDirectory()) walk(p); else out[r] = readFileSync(p).toString('latin1');
        }
      };
      walk(root);
      return out;
    },
  };
  try { return fn(ctx); } finally { rmSync(root, { recursive: true }); }
}
const manifest = (c) => JSON.parse(readFileSync(c.work('manifest.json'), 'utf8'));

test('dry run writes nothing and lists the lab, spec and image copies plus the rewrites', () => withRepo((c) => {
  const before = c.snapshot();
  const r = c.run(['demo', '--track', 'llm', '--dry-run']);
  assert.equal((r.out.match(/^copy /gm) || []).length, 4); // lab, spec, two images
  assert.match(r.out, /copy lab\s+\|.*\|\s+labs\/llm\/demo\.md/);
  assert.match(r.out, /copy spec\s+\|.*\|\s+e2e\/labs\/llm\/demo\.spec\.ts/);
  assert.match(r.out, /images\/llm\/demo\/01-a\.png/);
  assert.match(r.out, /rewrite e2e\/labs\/llm\/demo\.spec\.ts\s+\|\s+from '\.\.\/lib\/\s+\|\s+from '\.\.\/\.\.\/lib\//);
  assert.match(r.out, /dry run: nothing written/);
  assert.deepEqual(c.snapshot(), before);
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);
}));

test('a real run writes rewritten files, images and the manifest', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  const lab = c.read('labs/llm/demo.md');
  assert.match(lab, /!\[First page\]\(\.\.\/\.\.\/images\/llm\/demo\/01-a\.png\)/);
  assert.match(lab, /\[base lab\]\(001-base\.md\)/);
  assert.match(lab, /\[above\]\(#demo-lab\)/);
  assert.match(lab, /\(https:\/\/docs\.solo\.io\/x\)/);
  assert.ok(!lab.includes('custom-labs/'));
  const spec = c.read('e2e/labs/llm/demo.spec.ts');
  assert.equal(spec.split('\n')[0], '// labs/llm/demo.md');
  assert.match(spec, /from '\.\.\/\.\.\/lib\/lab'/);
  assert.match(spec, /lab\('llm', 'demo'\)/);
  assert.match(spec, /^\/\/ @req R1 The first page loads$/m);
  assert.ok(c.exists('images/llm/demo/01-a.png') && c.exists('images/llm/demo/02-b.png'));
  assert.deepEqual(readFileSync(join(c.root, 'images/llm/demo/01-a.png')), readFileSync(join(stageFixture, 'images/01-a.png')));
  const m = manifest(c);
  assert.equal(m.name, 'demo');
  assert.deepEqual(m.recorded, []);
  for (const f of ['labs/llm/demo.md', 'e2e/labs/llm/demo.spec.ts', 'images/llm/demo/01-a.png']) assert.ok(m.created.includes(f), f);
  for (const d of ['images/', 'images/llm/', 'images/llm/demo/']) assert.ok(m.created.includes(d), d);
  assert.ok(m.rewrites.length >= 4);
}));

test('--slug renames every target, and the spec rewrite follows', () => withRepo((c) => {
  c.run(['demo', '--track', 'mcp', '--slug', 'shiny']);
  assert.match(c.read('e2e/labs/mcp/shiny.spec.ts'), /^\/\/ labs\/mcp\/shiny\.md\n/);
  assert.match(c.read('e2e/labs/mcp/shiny.spec.ts'), /lab\('mcp', 'shiny'\)/);
  assert.match(c.read('labs/mcp/shiny.md'), /\(\.\.\/\.\.\/images\/mcp\/shiny\/01-a\.png\)/);
}));

test('the spec lab() call is rewritten with double quotes and odd spacing too', () => withRepo((c) => {
  const p = c.work('stage/demo.spec.ts');
  writeFileSync(p, readFileSync(p, 'utf8').replace("lab('custom', 'demo')", 'lab( "custom" ,"demo" )').replace(/'\.\.\/lib\/lab'/, '"../lib/lab"'));
  c.run(['demo', '--track', 'llm']);
  const spec = c.read('e2e/labs/llm/demo.spec.ts');
  assert.match(spec, /lab\('llm', 'demo'\)/);
  assert.match(spec, /from "\.\.\/\.\.\/lib\/lab"/);
}));

test('refuses an existing slug before writing anything', () => withRepo((c) => {
  c.write('labs/llm/demo.md', 'existing');
  const r = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /refusing to overwrite labs\/llm\/demo\.md/);
  assert.equal(c.exists('e2e/labs/llm/demo.spec.ts'), false);
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);
}));

test('refuses an existing spec or image target', () => withRepo((c) => {
  c.write('e2e/labs/llm/demo.spec.ts', 'x');
  assert.match(c.run(['demo', '--track', 'llm'], { ok: false }).err, /refusing to overwrite e2e\/labs\/llm\/demo\.spec\.ts/);
  rmSync(join(c.root, 'e2e/labs/llm/demo.spec.ts'));
  c.write('images/llm/demo/02-b.png', 'x');
  assert.match(c.run(['demo', '--track', 'llm'], { ok: false }).err, /refusing to overwrite images\/llm\/demo\/02-b\.png/);
  assert.equal(c.exists('labs/llm/demo.md'), false);
}));

test('refuses a missing track dir and an unknown track', () => withRepo((c) => {
  rmSync(join(c.root, 'labs/mcp'), { recursive: true });
  const r = c.run(['demo', '--track', 'mcp'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /no such track labs\/mcp\//);
  assert.equal(c.exists('labs/mcp'), false);
  const bad = c.run(['demo', '--track', 'security'], { ok: false });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /invalid track/);
  assert.equal(c.run(['demo'], { ok: false }).code, 1);
}));

test('refuses invalid names and slugs', () => withRepo((c) => {
  for (const args of [['../demo', '--track', 'llm'], ['Demo', '--track', 'llm'], ['demo', '--track', 'llm', '--slug', '../x'], ['demo', '--track', 'llm', '--slug', 'a/b']]) {
    const r = c.run(args, { ok: false });
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /invalid (name|slug)/);
  }
  assert.equal(c.exists('labs/llm/x.md'), false);
}));

test('refuses when the stage lacks the lab or the spec', () => withRepo((c) => {
  rmSync(c.work('stage/demo.spec.ts'));
  assert.match(c.run(['demo', '--track', 'llm'], { ok: false }).err, /missing .*demo\.spec\.ts in the staging copy/);
  rmSync(c.work('stage/demo.md'));
  assert.match(c.run(['demo', '--track', 'llm'], { ok: false }).err, /missing .*demo\.md in the staging copy/);
}));

test('a lab with no images dir is allowed; one that references images is refused', () => withRepo((c) => {
  writeFileSync(c.work('stage/demo.md'), '# demo\n\nNo pictures.\n');
  rmSync(c.work('stage/images'), { recursive: true });
  c.run(['demo', '--track', 'llm']);
  assert.equal(c.exists('images'), false);
  c.run(['demo', '--undo']);

  writeFileSync(c.work('stage/demo.md'), '# demo\n\n![x](images/01-a.png)\n');
  const r = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /references images\/ but the staging copy has no images/);
  assert.equal(c.exists('labs/llm/demo.md'), false);
}));

test('refuses when the rewritten lab or spec still holds custom-labs/', () => withRepo((c) => {
  writeFileSync(c.work('stage/demo.md'), readFileSync(c.work('stage/demo.md'), 'utf8') + '\ncp custom-labs/demo/x.yaml /tmp\n');
  const r = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /labs\/llm\/demo\.md still references custom-labs\//);
  assert.equal(c.exists('labs/llm/demo.md'), false);
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);

  cpSync(join(stageFixture, 'demo.md'), c.work('stage/demo.md'));
  writeFileSync(c.work('stage/demo.spec.ts'), readFileSync(c.work('stage/demo.spec.ts'), 'utf8') + "// see custom-labs/demo/CHANGES.md\n");
  const s = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(s.code, 1);
  assert.match(s.err, /demo\.spec\.ts still references custom-labs\//);
  assert.equal(c.exists('e2e/labs/llm/demo.spec.ts'), false);
}));

test('the custom lab is untouched and only the stage is read', () => withRepo((c) => {
  c.write('custom-labs/demo/demo.md', 'do not read me custom-labs/demo/x\n');
  const before = c.snapshot();
  c.run(['demo', '--track', 'llm']);
  for (const [k, v] of Object.entries(before)) if (k.startsWith('custom-labs/')) assert.equal(c.snapshot()[k], v);
  assert.ok(!c.read('labs/llm/demo.md').includes('do not read me'));
}));

test('record and undo restore a recorded file and remove created files and empty dirs', () => withRepo((c) => {
  const before = c.snapshot();
  c.run(['demo', '--track', 'llm']);
  c.run(['demo', '--record', 'README.md']);
  c.write('README.md', c.read('README.md') + '- [Demo](labs/llm/demo.md)\n');
  const r = c.run(['demo', '--undo']);
  assert.match(r.out, /restored README\.md/);
  assert.deepEqual(c.snapshot(), before);
  assert.equal(c.exists('images'), false);
  assert.ok(existsSync(join(c.root, 'e2e/labs/llm')), 'a dir that already existed is kept');
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);
}));

test('undo is tolerant when a created file was already deleted by hand', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  rmSync(join(c.root, 'images/llm/demo/01-a.png'));
  const r = c.run(['demo', '--undo']);
  assert.match(r.out, /already gone images\/llm\/demo\/01-a\.png/);
  assert.equal(c.exists('labs/llm/demo.md'), false);
  assert.equal(c.exists('images'), false);
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);
}));

test('undo keeps a non-empty created directory', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  c.write('images/llm/demo/mine.png', 'hand added');
  const r = c.run(['demo', '--undo']);
  assert.match(r.out, /kept non-empty directory images\/llm\/demo\//);
  assert.ok(c.exists('images/llm/demo/mine.png'));
}));

test('undo skips a recorded file with no saved copy and restores the rest', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  c.write('CHANGELOG.md', '0.1.0\n');
  c.run(['demo', '--record', 'README.md']);
  c.run(['demo', '--record', 'CHANGELOG.md']);
  c.write('README.md', 'edited\n');
  c.write('CHANGELOG.md', 'edited\n');
  rmSync(c.work(manifest(c).recorded[0].before));
  const r = c.run(['demo', '--undo']);
  assert.match(r.out, /skip README\.md: no saved copy/);
  assert.match(r.out, /check by hand, no saved copy was restored: README\.md/);
  assert.equal(c.read('CHANGELOG.md'), '0.1.0\n');
  assert.equal(c.read('README.md'), 'edited\n');
  assert.equal(c.exists('labs/llm/demo.md'), false);
  assert.equal(c.exists('e2e/.work/contribute/demo/manifest.json'), false);
}));

test('undo with a failing entry exits 1 and keeps the manifest and saved copies', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  c.write('docs/notes.md', 'notes\n');
  c.run(['demo', '--record', 'docs/notes.md']);
  rmSync(join(c.root, 'docs'), { recursive: true });
  c.write('docs', 'not a directory\n');
  const r = c.run(['demo', '--undo'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /undo incomplete; manifest kept/);
  assert.equal(c.exists('labs/llm/demo.md'), false);
  assert.ok(existsSync(c.work('manifest.json')));
  assert.ok(readdirSync(c.work('before')).length > 0);
}));

test('undo without a manifest exits 1', () => withRepo((c) => {
  const r = c.run(['demo', '--undo'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /no manifest/);
}));

test('record rejects paths outside the repo', () => withRepo((c) => {
  for (const p of [join(c.root, 'README.md'), '../outside.md', 'labs/../../x.md']) {
    const r = c.run(['demo', '--record', p], { ok: false });
    assert.equal(r.code, 1, p);
    assert.ok(r.err.includes(`record: ${p} is outside the repo`), r.err);
  }
  assert.equal(existsSync(c.work('manifest.json')), false);
  assert.equal(existsSync(c.work('before')), false);
}));

test('record refuses a file promote created and notes a repeat', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  const r = c.run(['demo', '--record', 'labs/llm/demo.md'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /was created by promote/);
  c.run(['demo', '--record', 'README.md']);
  assert.match(c.run(['demo', '--record', 'README.md']).out, /already recorded README\.md/);
  assert.equal(manifest(c).recorded.length, 1);
}));

test('a partial failure is recorded in the manifest and undoable', () => withRepo((c) => {
  // images/llm/demo is a file, so copying into it fails after the lab and spec were written.
  c.write('images/llm/demo', 'not a directory\n');
  const r = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(r.code, 1);
  const m = manifest(c);
  assert.ok(m.created.includes('labs/llm/demo.md'));
  assert.ok(c.exists('labs/llm/demo.md'));
  c.run(['demo', '--undo']);
  assert.equal(c.exists('labs/llm/demo.md'), false);
  assert.equal(c.exists('e2e/labs/llm/demo.spec.ts'), false);
}));

test('every lab() call in the spec is rewritten', () => withRepo((c) => {
  const p = c.work('stage/demo.spec.ts');
  writeFileSync(p, readFileSync(p, 'utf8') + "const other = lab(\"custom\", 'demo');\n");
  c.run(['demo', '--track', 'llm']);
  const spec = c.read('e2e/labs/llm/demo.spec.ts');
  assert.equal(spec.split("lab('llm', 'demo')").length - 1, 2);
  assert.ok(!spec.includes("'custom'") && !spec.includes('"custom"'));
}));

test('rewrite rows are deduplicated', () => withRepo((c) => {
  writeFileSync(c.work('stage/demo.md'), readFileSync(c.work('stage/demo.md'), 'utf8') + '[again](../../labs/llm/001-base.md)\n![third](images/01-a.png)\n');
  const r = c.run(['demo', '--track', 'llm']);
  assert.equal(r.out.split('../../labs/llm/001-base.md').length - 1, 1);
  const keys = manifest(c).rewrites.map((x) => `${x.file}\0${x.from}`);
  assert.equal(keys.length, new Set(keys).size);
}));

test('non-ASCII text and CRLF survive', () => withRepo((c) => {
  const text = '# Café → demo\r\nSee [base](../../labs/llm/001-base.md)\r\n';
  writeFileSync(c.work('stage/demo.md'), text);
  rmSync(c.work('stage/images'), { recursive: true });
  c.run(['demo', '--track', 'llm']);
  assert.equal(readFileSync(join(c.root, 'labs/llm/demo.md'), 'utf8'), text.replace('../../labs/llm/001-base.md', '001-base.md'));
}));

test('a gitignored target warns, an ordinary one does not, and no repo means no warning', () => withRepo((c) => {
  assert.doesNotMatch(c.run(['demo', '--track', 'llm', '--dry-run']).out, /warning:/);
  const git = spawnSync('git', ['init', '-q', c.root]);
  if (git.status !== 0) return;
  c.write('.gitignore', '*.spec.ts\n');
  const r = c.run(['demo', '--track', 'llm', '--dry-run']);
  assert.match(r.out, /warning: e2e\/labs\/llm\/demo\.spec\.ts is gitignored and will not be committed/);
  assert.doesNotMatch(r.out, /warning: labs\/llm\/demo\.md/);
}));

test('the defaults put the work dir under the repo root', () => withRepo((c) => {
  c.run(['demo', '--track', 'llm']);
  assert.ok(statSync(c.work('manifest.json')).isFile());
}));

test('an HTML img src and a non-PNG asset under images/ ship with working paths', () => withRepo((c) => {
  const lab = readFileSync(c.work('stage/demo.md'), 'utf8')
    + '\n<img src="images/01-a.png" width="600">\n\n![Diagram](images/diagram.svg)\n';
  writeFileSync(c.work('stage/demo.md'), lab);
  writeFileSync(c.work('stage/images/diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  writeFileSync(c.work('stage/images/.DS_Store'), 'junk');
  c.run(['demo', '--track', 'llm']);
  const out = c.read('labs/llm/demo.md');
  assert.match(out, /<img src="\.\.\/\.\.\/images\/llm\/demo\/01-a\.png" width="600">/);
  assert.match(out, /!\[Diagram\]\(\.\.\/\.\.\/images\/llm\/demo\/diagram\.svg\)/);
  assert.ok(!/src="images\//.test(out));
  assert.ok(c.exists('images/llm/demo/diagram.svg'));
  assert.equal(c.exists('images/llm/demo/.DS_Store'), false);
  assert.ok(manifest(c).rewrites.some((r) => r.from === 'src="images/'));
}));

test('a lab that references an images/ file the stage lacks is refused', () => withRepo((c) => {
  writeFileSync(c.work('stage/demo.md'), readFileSync(c.work('stage/demo.md'), 'utf8') + "\n<img src='images/09-gone.png'>\n");
  const r = c.run(['demo', '--track', 'llm'], { ok: false });
  assert.equal(r.code, 1);
  assert.match(r.err, /references images\/09-gone\.png but the staging copy has no such file/);
  assert.equal(c.exists('labs/llm/demo.md'), false);
}));

test('recorded paths that differ only in / versus __ keep separate saved copies', () => withRepo((c) => {
  c.write('a/b__c.md', 'first\n');
  c.write('a__b/c.md', 'second\n');
  c.run(['demo', '--record', 'a/b__c.md']);
  c.run(['demo', '--record', 'a__b/c.md']);
  const saved = manifest(c).recorded.map((r) => r.before);
  assert.equal(new Set(saved).size, 2);
  c.write('a/b__c.md', 'edited\n');
  c.write('a__b/c.md', 'edited\n');
  c.run(['demo', '--undo']);
  assert.equal(c.read('a/b__c.md'), 'first\n');
  assert.equal(c.read('a__b/c.md'), 'second\n');
}));
