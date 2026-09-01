// Tell the note-writer exactly what changed in each gist revision that has no
// hand-written history note yet. Zero dependencies beyond Node and the `git`
// binary; `npm run notes:missing` runs it. (No shebang: the file is also
// imported by tests/unit/history-notes-missing.test.ts through Vite, which
// does not strip one.)
//
//   node scripts/history-notes-missing.mjs [--root <repo root>] [--history <path>] [--notes <path>]
//
// The daily refresh (refresh-gist.yml) rewrites content/gist/history.json and
// the per-revision snapshots content/gist/history/NN-<short>.md, but never
// content/gist/history-notes.json. tests/unit/history-notes.test.ts fails until
// every revision's `version` sha has a note there, so this script prints, for
// each revision without one:
//
//   Revision 17 of 17 — 2026-09-01T13:11:39Z — +42 −17 — sha 0123abc…
//   0123abc0123abc0123abc0123abc0123abc01234
//   Previous revision: 16 (sha …)
//   --- diff of build-the-urlist.md, revision 16 → 17 ---
//   <unified diff, 3 lines of context, of the two snapshots>
//
// The diff is `git diff --no-index --unified=3` between the two snapshot files,
// with the `diff --git` and `index` header lines dropped so each block starts
// at `---`/`+++`. The first revision has no predecessor: `First revision — no diff.`
//
// Flags (each optional):
//   --root <dir>      repo root the snapshot paths in history.json are relative to
//                     (default: this script's repo root)
//   --history <path>  history.json to read (default: <root>/content/gist/history.json)
//   --notes <path>    history-notes.json to read (default: <root>/content/gist/history-notes.json);
//                     point it at a copy to preview what a missing note would print
//   -h, --help        show this help
//
// Blocks and the closing summary go to stdout; only errors go to stderr.
// Exit codes: 0 every revision has a note (`All N revisions have a note.`) ·
// 1 at least one revision is missing a note (the blocks were printed) ·
// 2 usage or unreadable input.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotName } from './lib/history.mjs';

const EXIT_OK = 0;
const EXIT_MISSING = 1;
const EXIT_USAGE = 2;
const SHA_RE = /^[0-9a-f]{40}$/;
const CONTEXT_LINES = 3;

const USAGE = `usage: node scripts/history-notes-missing.mjs [--root <repo root>] [--history <path>] [--notes <path>]

  --root <dir>      repo root the snapshot paths in history.json are relative to (default: this repo)
  --history <path>  history.json to read (default: <root>/content/gist/history.json)
  --notes <path>    history-notes.json to read (default: <root>/content/gist/history-notes.json)
  -h, --help        show this help`;

class UsageError extends Error {}

/**
 * The note map of a parsed history-notes.json (`{ notes: { <sha>: <sentence> } }`),
 * or an empty object when the document has none.
 */
function notesMap(notesDoc) {
  const map = notesDoc && typeof notesDoc === 'object' ? notesDoc.notes : null;
  return map && typeof map === 'object' ? map : {};
}

/**
 * Whether `version` has a note: an own, non-empty string entry keyed by a full
 * 40-hex sha. Inherited keys (`constructor`, `toString`) and `__proto__` never
 * count, so a revision can only be satisfied by a real sha key.
 */
export function hasNote(notesDoc, version) {
  if (typeof version !== 'string' || !SHA_RE.test(version)) return false;
  const map = notesMap(notesDoc);
  if (!Object.prototype.hasOwnProperty.call(map, version)) return false;
  const note = map[version];
  return typeof note === 'string' && note.trim() !== '';
}

/**
 * The revisions of a parsed history.json that have no note in a parsed
 * history-notes.json, in history order (oldest → newest). Each item is the
 * revision record plus `previous`: the record before it in the history, or
 * `null` for the first revision.
 */
export function missingRevisions(history, notesDoc) {
  const revisions = Array.isArray(history?.revisions) ? history.revisions : [];
  const missing = [];
  revisions.forEach((rec, index) => {
    if (!rec || typeof rec !== 'object') return;
    if (hasNote(notesDoc, rec.version)) return;
    const previous = index > 0 && revisions[index - 1] && typeof revisions[index - 1] === 'object' ? revisions[index - 1] : null;
    missing.push({ ...rec, previous });
  });
  return missing;
}

/** `history/16-8ef29d7.md` (history.json `file`), else the conventional name. */
function snapshotPath(root, rec) {
  const file = typeof rec.file === 'string' && rec.file ? rec.file : snapshotName({ n: rec.n, short: shortSha(rec) });
  return path.join(root, 'content', 'gist', ...file.split('/'));
}

function shortSha(rec) {
  return typeof rec.short === 'string' && rec.short ? rec.short : String(rec.version ?? '').slice(0, 7);
}

function relative(root, file) {
  const rel = path.relative(root, file);
  // Outside the root (a temp copy passed with --notes) the absolute path reads better than ../../..
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return file.split(path.sep).join('/');
  return rel.split(path.sep).join('/');
}

/**
 * Unified diff of two snapshot files via `git diff --no-index`, minus the
 * `diff --git`/`index` header lines. Returns the lines, `[]` when identical.
 */
export function snapshotDiff(root, prevFile, currFile) {
  const result = spawnSync(
    'git',
    ['-c', 'core.quotepath=false', 'diff', '--no-index', '--no-color', '--no-ext-diff', `--unified=${CONTEXT_LINES}`, '--', relative(root, prevFile), relative(root, currFile)],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  if (result.error) throw new Error(`git diff failed: ${result.error.message}`);
  // 0 = identical, 1 = different; anything else is a real failure.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git diff exited ${result.status}: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line, i, all) => !(i === all.length - 1 && line === ''))
    .filter((line) => !line.startsWith('diff --git ') && !line.startsWith('index '));
}

/** The printed block for one missing revision. */
export function formatBlock(rec, total, { root, filename }) {
  const stamp = rec.committed_at ?? 'unknown date';
  const lines = [
    `Revision ${rec.n} of ${total} — ${stamp} — +${rec.additions ?? '?'} −${rec.deletions ?? '?'} — sha ${shortSha(rec)}…`,
    String(rec.version ?? ''),
  ];
  if (!rec.previous) {
    lines.push('First revision — no diff.');
    return lines;
  }
  const prev = rec.previous;
  lines.push(`Previous revision: ${prev.n} (sha ${prev.version})`);
  lines.push(`--- diff of ${filename}, revision ${prev.n} → ${rec.n} ---`);
  const diff = snapshotDiff(root, snapshotPath(root, prev), snapshotPath(root, rec));
  lines.push(...(diff.length ? diff : ['(snapshots are byte-for-byte identical)']));
  return lines;
}

function parseArgs(argv) {
  const opts = {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    history: null,
    notes: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
      return v;
    };
    if (arg === '--root') opts.root = path.resolve(takeValue(arg));
    else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice('--root='.length));
    else if (arg === '--history') opts.history = path.resolve(takeValue(arg));
    else if (arg.startsWith('--history=')) opts.history = path.resolve(arg.slice('--history='.length));
    else if (arg === '--notes') opts.notes = path.resolve(takeValue(arg));
    else if (arg.startsWith('--notes=')) opts.notes = path.resolve(arg.slice('--notes='.length));
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  opts.history ??= path.join(opts.root, 'content', 'gist', 'history.json');
  opts.notes ??= path.join(opts.root, 'content', 'gist', 'history-notes.json');
  return opts;
}

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${label} at ${file}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`${label} at ${file} is not valid JSON: ${err.message}`);
  }
}

function readJsonIfExists(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function main(argv, out = (line) => process.stdout.write(`${line}\n`)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    out(USAGE);
    return EXIT_OK;
  }
  const history = readJson(opts.history, 'history.json');
  const notes = readJson(opts.notes, 'history-notes.json');
  const meta = readJsonIfExists(path.join(opts.root, 'content', 'gist', 'meta.json'));
  const filename = typeof meta?.filename === 'string' && meta.filename ? meta.filename : 'the gist file';

  const revisions = Array.isArray(history?.revisions) ? history.revisions : [];
  const missing = missingRevisions(history, notes);
  if (missing.length === 0) {
    out(`All ${revisions.length} revisions have a note.`);
    return EXIT_OK;
  }
  missing.forEach((rec, i) => {
    if (i > 0) out('');
    for (const line of formatBlock(rec, revisions.length, { root: opts.root, filename })) out(line);
  });
  out('');
  out(`${missing.length} of ${revisions.length} revision(s) have no note in ${relative(opts.root, opts.notes)}.`);
  return EXIT_MISSING;
}

const normalise = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
const invokedDirectly = process.argv[1] !== undefined && normalise(process.argv[1]) === normalise(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n\n${USAGE}`);
      process.exitCode = EXIT_USAGE;
    } else {
      console.error(`error: ${err?.message ?? err}`);
      process.exitCode = EXIT_USAGE;
    }
  }
}
