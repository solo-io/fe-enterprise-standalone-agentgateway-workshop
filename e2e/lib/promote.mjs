// Copies a staged custom lab into the repo as a shipped lab. Port of the workshop's promote.py.
//
//   node lib/promote.mjs NAME --track <llm|mcp|platform> [--slug SLUG] [--stage DIR] [--root REPO] [--work DIR] [--dry-run]
//       copies <stage>/NAME.md to labs/<track>/<slug>.md, <stage>/NAME.spec.ts to e2e/labs/<track>/<slug>.spec.ts and
//       every file in <stage>/images/ (PNGs and any other asset, not dotfiles) to images/<track>/<slug>/. The slug
//       defaults to NAME. In the spec, line 1 becomes "// labs/<track>/<slug>.md", "from '../lib/" becomes
//       "from '../../lib/" and lab('custom', 'NAME') becomes lab('<track>', '<slug>'). In the lab, "](images/" and an
//       HTML src="images/" become "../../images/<track>/<slug>/", and every other relative Markdown link target is
//       recomputed from custom-labs/NAME/ to labs/<track>/ (absolute URLs and fragments are kept). NAME, the track
//       and the slug are single segments matching ^[a-z0-9][a-z0-9-]*$, and labs/<track>/ must exist. Refuses to run
//       when any target exists, when the stage lacks the lab or the spec, when the lab references an images/ file the
//       stage does not have, or when the rewritten lab or spec still holds custom-labs/. Prints a warning for each
//       target git ignores. Writes <work>/manifest.json.
//   node lib/promote.mjs NAME --record FILE [--root REPO] [--work DIR]
//       saves a copy of the repo-relative FILE under <work>/before/ so --undo can restore it after a later hand
//       edit. The copy's name is the path percent-encoded, so two paths never share one. Refuses absolute paths and
//       paths outside the repo.
//   node lib/promote.mjs NAME --undo [--root REPO] [--work DIR]
//       restores recorded files, deletes the files a run created, and removes the directories it created once they
//       are empty. An entry that fails is reported and the rest still run. The saved copies and the manifest are
//       removed only when every entry succeeded; otherwise undo exits 1 and keeps them.
//
// Defaults: --root is two levels above this file, --work is <root>/e2e/.work/contribute/NAME/, --stage is
// <work>/stage/. The tool reads the staging copy only and never reads or writes custom-labs/.
//
// Manifest: {"name", "created", "recorded", "rewrites"}. "created" lists repo-relative paths in creation order; a
// directory the run created ends with "/". "recorded" holds {"path", "before"} with "before" relative to <work>.
// "rewrites" holds {"file", "from", "to"}. Exits 0 on success, 1 on any refusal or error.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// Same link pattern as the Python tool: the target, then an optional "title".
const LINK_RE = /\]\(([^)\s#][^)\s]*)(\s+"[^"]*")?\)/g;
// An HTML image or source tag's src="images/..." (single or double quotes).
const HTML_SRC_RE = /(\bsrc\s*=\s*)(["'])images\/([^"']*)\2/g;
const SEGMENT_RE = /^[a-z0-9][a-z0-9-]*$/;
const TRACKS = ['llm', 'mcp', 'platform'];

class PromoteError extends Error {}

const rel = (p) => p.split(sep).join('/');
const lexists = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function defaultRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

// One planned copy: kind is lab, spec or image; src is absolute, dst is repo-relative.
function plan({ name, track, slug, stage, root }) {
  const labSrc = join(stage, `${name}.md`);
  const specSrc = join(stage, `${name}.spec.ts`);
  for (const p of [labSrc, specSrc]) if (!isFile(p)) throw new PromoteError(`missing ${p} in the staging copy`);
  const moves = [
    { kind: 'lab', src: labSrc, dst: `labs/${track}/${slug}.md` },
    { kind: 'spec', src: specSrc, dst: `e2e/labs/${track}/${slug}.spec.ts` },
  ];
  const imgDir = join(stage, 'images');
  if (isDir(imgDir)) {
    for (const f of readdirSync(imgDir).sort()) {
      if (!f.startsWith('.') && isFile(join(imgDir, f))) moves.push({ kind: 'image', src: join(imgDir, f), dst: `images/${track}/${slug}/${f}` });
    }
  }
  for (const m of moves) if (lexists(join(root, m.dst))) throw new PromoteError(`refusing to overwrite ${m.dst}`);
  return moves;
}

function addRewrite(rewrites, file, from, to) {
  if (!rewrites.some((r) => r.file === file && r.from === from && r.to === to)) rewrites.push({ file, from, to });
}

// The images/ paths a lab references in Markdown links and HTML src attributes, without query or fragment.
function imageRefs(text) {
  const refs = [];
  for (const m of text.matchAll(LINK_RE)) if (m[1].startsWith('images/')) refs.push(m[1].slice('images/'.length));
  for (const m of text.matchAll(HTML_SRC_RE)) refs.push(m[3]);
  return refs.map((r) => r.replace(/[?#].*$/, ''));
}

function rewriteLab(text, { name, track, slug, images }, newDir, rewrites, file) {
  const oldDir = `custom-labs/${name}`;
  const refs = imageRefs(text);
  if (refs.length && images.size === 0) {
    throw new PromoteError('the lab references images/ but the staging copy has no images');
  }
  for (const r of refs) {
    if (!images.has(r)) throw new PromoteError(`the lab references images/${r} but the staging copy has no such file in images/`);
  }
  const html = text.replace(HTML_SRC_RE, (_m, attr, q, rest) => {
    addRewrite(rewrites, file, `src=${q}images/`, `src=${q}../../images/${track}/${slug}/`);
    return `${attr}${q}../../images/${track}/${slug}/${rest}${q}`;
  });
  return html.replace(LINK_RE, (whole, target, title = '') => {
    if (target.startsWith('images/')) {
      addRewrite(rewrites, file, '](images/', `](../../images/${track}/${slug}/`);
      return `](../../images/${track}/${slug}/${target.slice('images/'.length)}${title})`;
    }
    if (target.includes('://') || target.startsWith('mailto:') || target.startsWith('/')) return whole;
    let path = target;
    let frag = '';
    const hash = target.indexOf('#');
    if (hash !== -1) { path = target.slice(0, hash); frag = target.slice(hash); }
    const resolved = posix.normalize(posix.join(oldDir, path));
    const next = (posix.relative(newDir, resolved) || '.') + frag;
    if (next !== target) addRewrite(rewrites, file, target, next);
    return `](${next}${title})`;
  });
}

function rewriteSpec(text, { name, track, slug }, rewrites, file) {
  const eol = text.indexOf('\n');
  const first = eol === -1 ? text : text.slice(0, eol).replace(/\r$/, '');
  if (!first.startsWith('// custom-labs/')) throw new PromoteError(`the spec's first line is not "// custom-labs/${name}/${name}.md": ${first}`);
  const newFirst = `// labs/${track}/${slug}.md`;
  addRewrite(rewrites, file, first, newFirst);
  let out = newFirst + text.slice(first.length);

  if (/from (['"])\.\.\/lib\//.test(out)) {
    out = out.replace(/from (['"])\.\.\/lib\//g, (_m, q) => `from ${q}../../lib/`);
    addRewrite(rewrites, file, "from '../lib/", "from '../../lib/");
  }
  // New in the port (the Python spec was YAML): the quotes may be single or double but must pair up.
  const call = new RegExp(`lab\\(\\s*(['"])custom\\1\\s*,\\s*(['"])${name}\\2\\s*\\)`, 'g');
  const found = out.match(call);
  if (!found) throw new PromoteError(`the spec has no lab('custom', '${name}') call`);
  const newCall = `lab('${track}', '${slug}')`;
  out = out.replace(call, newCall);
  for (const orig of found) addRewrite(rewrites, file, orig, newCall);
  return out;
}

function checkLeftover(dst, text) {
  if (text.includes('custom-labs/')) {
    const line = text.split(/\r?\n/).find((l) => l.includes('custom-labs/'));
    throw new PromoteError(`${dst} still references custom-labs/ after rewriting: ${line.trim()}`);
  }
}

// Returns { contents: {dst: new text or null for a byte copy}, rewrites }.
function render(moves, ctx) {
  const rewrites = [];
  const contents = {};
  const images = new Set(moves.filter((m) => m.kind === 'image').map((m) => posix.basename(m.dst)));
  for (const m of moves) {
    if (m.kind === 'image') { contents[m.dst] = null; continue; }
    const text = readFileSync(m.src, 'utf8');
    const out = m.kind === 'lab'
      ? rewriteLab(text, { ...ctx, images }, posix.dirname(m.dst), rewrites, m.dst)
      : rewriteSpec(text, ctx, rewrites, m.dst);
    checkLeftover(m.dst, out);
    contents[m.dst] = out;
  }
  return { contents, rewrites };
}

const manifestPath = (work) => join(work, 'manifest.json');

function loadManifest(work, name) {
  if (existsSync(manifestPath(work))) return JSON.parse(readFileSync(manifestPath(work), 'utf8'));
  return { name, created: [], recorded: [], rewrites: [] };
}

function saveManifest(work, m) {
  mkdirSync(work, { recursive: true });
  const tmp = `${manifestPath(work)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`);
  renameSync(tmp, manifestPath(work));
}

function show(src, root) {
  const a = resolve(src);
  const r = resolve(root);
  return a.startsWith(r + sep) ? rel(a.slice(r.length + 1)) : a;
}

function table(rows) {
  const all = [['action', 'source', 'target'], ...rows];
  const widths = [0, 1, 2].map((i) => Math.max(...all.map((r) => r[i].length)));
  const lines = [];
  all.forEach((r, i) => {
    lines.push(r.map((c, j) => c.padEnd(widths[j])).join(' | ').trimEnd());
    if (i === 0) lines.push(widths.map((w) => '-'.repeat(w)).join('-|-'));
  });
  return lines.join('\n');
}

// Targets git would ignore; empty when git is missing or root is not a work tree.
function ignoredTargets(dsts, root) {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') return [];
  return dsts.filter((d) => spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', d]).status === 0);
}

// Writes every target and the manifest (nothing with dryRun) and returns the table text. The manifest is saved after
// each write, so a run that fails partway can be undone.
function apply(moves, { work, root, name, dryRun, ...ctx }) {
  const { contents, rewrites } = render(moves, { name, ...ctx });
  const rows = moves.map((m) => [`copy ${m.kind}`, show(m.src, root), m.dst]);
  for (const r of rewrites) rows.push([`rewrite ${r.file}`, r.from, r.to]);
  const warnings = ignoredTargets(moves.map((m) => m.dst), root)
    .map((d) => `warning: ${d} is gitignored and will not be committed`);
  const out = [table(rows), ...warnings].join('\n');
  if (dryRun) return out;

  const m = loadManifest(work, name);
  for (const r of rewrites) addRewrite(m.rewrites, r.file, r.from, r.to);
  for (const mv of moves) {
    const missing = [];
    let parent = posix.dirname(mv.dst);
    while (parent !== '.' && !isDir(join(root, parent))) { missing.push(parent); parent = posix.dirname(parent); }
    for (const d of missing.reverse()) {
      mkdirSync(join(root, d));
      m.created.push(`${d}/`);
      saveManifest(work, m);
    }
    const dst = join(root, mv.dst);
    if (contents[mv.dst] === null) copyFileSync(mv.src, dst);
    else writeFileSync(dst, contents[mv.dst]);
    m.created.push(mv.dst);
    saveManifest(work, m);
  }
  return out;
}

function record(name, path, root, work) {
  const norm = rel(posix.normalize(rel(path)));
  if (isAbsolute(path) || norm === '..' || norm.startsWith('../')) throw new PromoteError(`record: ${path} is outside the repo`);
  const src = join(root, norm);
  if (!isFile(src)) throw new PromoteError(`cannot record ${norm}: not a file`);
  const m = loadManifest(work, name);
  if (m.created.includes(norm)) throw new PromoteError(`${norm} was created by promote; undo deletes it, no need to record`);
  if (m.recorded.some((r) => r.path === norm)) { console.log(`already recorded ${norm}`); return; }
  const before = `before/${encodeURIComponent(norm)}`;
  const dst = join(work, before);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  m.recorded.push({ path: norm, before });
  saveManifest(work, m);
  console.log(`recorded ${norm} -> ${before}`);
}

// Restores, deletes and removes each entry on its own; an entry that fails is reported and the rest still run. The
// saved copies and the manifest go only when every entry succeeded, so an incomplete undo can be rerun.
function undo(root, work) {
  const path = manifestPath(work);
  if (!existsSync(path)) throw new PromoteError(`no manifest at ${path}`);
  const m = JSON.parse(readFileSync(path, 'utf8'));
  let ok = true;
  const skipped = [];
  for (const r of m.recorded) {
    const saved = join(work, r.before);
    if (!isFile(saved)) {
      // An earlier undo already restored this file, or the saved copy was removed. Nothing is written, so skipping
      // is safe; the user checks the file by hand.
      console.log(`skip ${r.path}: no saved copy`);
      skipped.push(r.path);
      continue;
    }
    try { copyFileSync(saved, join(root, r.path)); console.log(`restored ${r.path}`); } catch (e) {
      console.log(`cannot restore ${r.path}: ${e.message}`);
      ok = false;
    }
  }
  for (const c of m.created.filter((x) => !x.endsWith('/'))) {
    try {
      if (lexists(join(root, c))) { unlinkSync(join(root, c)); console.log(`deleted ${c}`); } else console.log(`already gone ${c}`);
    } catch (e) { console.log(`cannot delete ${c}: ${e.message}`); ok = false; }
  }
  const dirs = m.created.filter((x) => x.endsWith('/')).map((x) => x.replace(/\/+$/, ''));
  dirs.sort((a, b) => b.split('/').length - a.split('/').length);
  for (const d of dirs) {
    const p = join(root, d);
    try {
      if (isDir(p) && readdirSync(p).length === 0) { rmdirSync(p); console.log(`removed directory ${d}/`); } else if (isDir(p)) console.log(`kept non-empty directory ${d}/`);
    } catch (e) { console.log(`cannot remove directory ${d}/: ${e.message}`); ok = false; }
  }
  if (!ok) throw new PromoteError('undo incomplete; manifest kept');
  for (const r of m.recorded) rmSync(join(work, r.before), { force: true });
  if (skipped.length) console.log(`check by hand, no saved copy was restored: ${skipped.join(', ')}`);
  const beforeDir = join(work, 'before');
  if (isDir(beforeDir) && readdirSync(beforeDir).length === 0) rmdirSync(beforeDir);
  unlinkSync(path);
  console.log(`removed manifest ${show(path, root)}`);
}

export function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true,
      options: {
        track: { type: 'string' }, slug: { type: 'string' }, stage: { type: 'string' }, root: { type: 'string' },
        work: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, record: { type: 'string' },
        undo: { type: 'boolean', default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`promote: ${e.message}\n`);
    return 1;
  }
  const { values: o, positionals } = parsed;
  const root = resolve(o.root ?? defaultRoot());
  try {
    if (positionals.length !== 1) throw new PromoteError('expected exactly one NAME');
    const name = positionals[0];
    if (!SEGMENT_RE.test(name)) throw new PromoteError(`invalid name: ${name}`);
    const work = resolve(o.work ?? join(root, 'e2e', '.work', 'contribute', name));
    const stage = resolve(o.stage ?? join(work, 'stage'));
    if (o.undo) undo(root, work);
    else if (o.record !== undefined) record(name, o.record, root, work);
    else {
      const { track } = o;
      if (!track) throw new PromoteError('--track is required');
      if (!TRACKS.includes(track)) throw new PromoteError(`invalid track: ${track} (expected ${TRACKS.join(', ')})`);
      if (!isDir(join(root, 'labs', track))) throw new PromoteError(`no such track labs/${track}/`);
      const slug = o.slug ?? name;
      if (!SEGMENT_RE.test(slug)) throw new PromoteError(`invalid slug: ${slug}`);
      const moves = plan({ name, track, slug, stage, root });
      console.log(apply(moves, { work, root, name, track, slug, dryRun: o['dry-run'] }));
      if (o['dry-run']) console.log('dry run: nothing written');
    }
  } catch (e) {
    if (e instanceof PromoteError) process.stderr.write(`promote: ${e.message}\n`);
    else if (e && e.code) process.stderr.write(`promote: ${e.message} (run --undo to remove what was written)\n`);
    else throw e;
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
