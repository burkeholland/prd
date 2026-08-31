#!/usr/bin/env node
// Snapshot every revision of the sample PRD gist into this repo, so a page
// about how the PRD evolved can be built offline. Zero dependencies beyond
// Node and the `git` binary.
//
//   node scripts/fetch-gist-history.mjs [--gist <id>] [--out <repo root>] [--owner <login>] [--dry-run]
//
// One anonymous `git clone --no-checkout` of the gist gives the revision list
// (`git log`), the +/- line counts of every revision (`git diff --numstat`, the
// root commit included) and each revision's file (`git cat-file blob`). No
// REST API, no token, no API rate limit. Git does not record the gist's owner;
// it comes from --owner, else content/gist/meta.json, else history.json, else
// the default owner.
//
// Writes (idempotently):
//   content/gist/history/NN-<short>.md   the gist file at revision NN (1 = oldest), bytes verbatim
//   content/gist/history.json            per-revision date, +/- line counts, bytes, lines, URL + totals
//
// Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GIST_ID, DEFAULT_OWNER, pickGistFile } from './lib/gist.mjs';
import { blob, files, log, numstat, withGistClone } from './lib/gist-git.mjs';
import {
  SNAPSHOT_FILE_RE,
  historyDocument,
  keepPreviousFetchedAt,
  lineEndingStyle,
  revisionsFromLog,
  snapshotName,
} from './lib/history.mjs';

const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: node scripts/fetch-gist-history.mjs [--gist <id>] [--out <repo root>] [--owner <login>] [--dry-run]

  --gist <id>       gist id (default ${DEFAULT_GIST_ID})
  --out <dir>       repo root to write into (default: this script's repo root)
  --owner <login>   gist owner for the revision URLs (default: content/gist/meta.json, else ${DEFAULT_OWNER})
  --dry-run         fetch and validate, print the plan, write nothing
  -h, --help        show this help`;

class UsageError extends Error {}
class FetchError extends Error {}

function parseArgs(argv) {
  const opts = {
    gist: DEFAULT_GIST_ID,
    out: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    owner: null,
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
      return v;
    };
    if (arg === '--gist') opts.gist = takeValue(arg);
    else if (arg.startsWith('--gist=')) opts.gist = arg.slice('--gist='.length);
    else if (arg === '--out') opts.out = path.resolve(takeValue(arg));
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice('--out='.length));
    else if (arg === '--owner') opts.owner = takeValue(arg);
    else if (arg.startsWith('--owner=')) opts.owner = arg.slice('--owner='.length);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]+$/i.test(opts.gist)) throw new UsageError(`--gist must be a hex gist id, got "${opts.gist}"`);
  if (opts.owner !== null && !/^[A-Za-z0-9-]+$/.test(opts.owner)) {
    throw new UsageError(`--owner must be a GitHub login, got "${opts.owner}"`);
  }
  return opts;
}

function validateSnapshot(rec, filename, bytes) {
  const label = `revision ${rec.n} (${rec.short}) ${filename}`;
  if (bytes.length === 0) throw new FetchError(`${label}: snapshot is empty`);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new FetchError(`${label}: snapshot is not valid UTF-8`);
  if (!text.startsWith('# ')) {
    throw new FetchError(`${label}: snapshot does not start with the gist's "# " h1 (got ${JSON.stringify(text.slice(0, 20))})`);
  }
  if (!/^[0-9a-f]{40}$/.test(rec.version)) throw new FetchError(`${label}: version is not a 40-hex sha`);
  if (Number.isNaN(Date.parse(rec.committed_at ?? ''))) throw new FetchError(`${label}: committed_at is not a date`);
}

/**
 * Everything the history needs, from one clone: the file to follow (picked at
 * HEAD), the revision records with their +/- counts, and each revision's bytes.
 */
async function readGistHistory(id, owner, dryRun) {
  return withGistClone(id, async (dir) => {
    const entries = await log(dir);
    if (entries.length === 0) throw new FetchError(`gist ${id} has no history`);
    const filename = pickGistFile(await files(dir, entries.at(-1).version));
    if (!filename) throw new FetchError(`gist ${id} has no file to follow`);

    const counts = new Map();
    for (let i = 0; i < entries.length; i++) {
      const parent = i > 0 ? entries[i - 1].version : null;
      counts.set(entries[i].version, await numstat(dir, parent, entries[i].version, filename));
    }
    const revisions = revisionsFromLog(entries, counts, { id, owner });

    console.log(
      `gist ${id} (${owner}) — ${filename}, ${revisions.length} revision(s) ` +
        `${revisions[0].committed_at} → ${revisions.at(-1).committed_at}${dryRun ? ' [dry run]' : ''}`,
    );

    const snapshots = new Map();
    for (const rec of revisions) {
      const bytes = await blob(dir, rec.version, filename);
      validateSnapshot(rec, filename, bytes);
      snapshots.set(rec.version, bytes);
      console.log(
        `  ${String(rec.n).padStart(2, '0')}/${revisions.length} ${rec.short} ${rec.committed_at} ` +
          `+${rec.additions} -${rec.deletions} ${bytes.length} bytes ${lineEndingStyle(bytes)}`,
      );
    }
    return { filename, revisions, snapshots };
  });
}

async function readIfExists(file) {
  try {
    return await readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function readJsonIfExists(file) {
  const bytes = await readIfExists(file);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

/** The owner is not in git: a flag wins, then meta.json / history.json of the same gist, then the default. */
function resolveOwner(opts, meta, previousDoc) {
  const from = (doc) => (doc?.id === opts.gist && typeof doc.owner === 'string' ? doc.owner : null);
  return opts.owner ?? from(meta) ?? from(previousDoc) ?? DEFAULT_OWNER;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const root = opts.out;
  const gistDir = path.join(root, 'content', 'gist');
  const historyDir = path.join(gistDir, 'history');
  const historyFile = path.join(gistDir, 'history.json');
  const meta = await readJsonIfExists(path.join(gistDir, 'meta.json'));
  const previousDoc = await readJsonIfExists(historyFile);
  const owner = resolveOwner(opts, meta, previousDoc);

  const { filename, revisions, snapshots } = await readGistHistory(opts.gist, owner, opts.dryRun);

  // Report — never normalise — a revision whose line endings differ from the newest one.
  const newestStyle = lineEndingStyle(snapshots.get(revisions.at(-1).version));
  for (const rec of revisions) {
    const style = lineEndingStyle(snapshots.get(rec.version));
    if (style !== newestStyle) {
      console.error(`warning: revision ${rec.n} (${rec.short}) uses ${style} line endings, newest is ${newestStyle}`);
    }
  }

  // Cross-check against the single-revision snapshot when both exist for the same revision.
  const rawFile = path.join(root, 'public', 'raw', filename);
  const current = meta?.id === opts.gist ? revisions.find((r) => r.version === meta.revision) : null;
  if (current) {
    const raw = await readIfExists(rawFile);
    if (raw && !raw.equals(snapshots.get(current.version))) {
      console.error(
        `warning: ${rel(root, rawFile)} differs from revision ${current.n} (${current.short}) ` +
          'although meta.json says they are the same revision — rerun scripts/fetch-gist.mjs',
      );
    }
  }

  const fetchedAt = new Date().toISOString();
  const doc = keepPreviousFetchedAt(
    previousDoc,
    historyDocument({ id: opts.gist, owner, fetched_at: fetchedAt, revisions, files: snapshots }),
  );

  const plan = [
    ...revisions.map((rec) => ({ file: path.join(gistDir, snapshotName(rec)), bytes: snapshots.get(rec.version) })),
    { file: historyFile, bytes: Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8') },
  ];

  // Snapshots of revisions that no longer exist (rewritten gist history).
  const keep = new Set(revisions.map((rec) => path.basename(snapshotName(rec))));
  const stale = (await readdir(historyDir).catch(() => [])).filter((f) => SNAPSHOT_FILE_RE.test(f) && !keep.has(f));

  const verb = opts.dryRun ? 'would write' : 'wrote';
  for (const { file: target, bytes } of plan) {
    const before = await readIfExists(target);
    const state = before === null ? 'new' : before.equals(bytes) ? 'unchanged' : 'updated';
    if (!opts.dryRun) await writeAtomic(target, bytes);
    console.log(`${verb} ${rel(root, target)} ${bytes.length} bytes (${state})`);
  }
  for (const name of stale) {
    const target = path.join(historyDir, name);
    if (!opts.dryRun) await unlink(target);
    console.log(`${opts.dryRun ? 'would remove' : 'removed'} ${rel(root, target)} (stale)`);
  }
  console.log(
    `${opts.dryRun ? 'planned' : 'done:'} ${plan.length} files, ${doc.count} revisions, ` +
      `+${doc.additions_total} -${doc.deletions_total}, fetched_at ${doc.fetched_at}`,
  );
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  } else {
    console.error(`error: ${err?.message ?? err}`);
    process.exitCode = EXIT_FAIL;
  }
}
