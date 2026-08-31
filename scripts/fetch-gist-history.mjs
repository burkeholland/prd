#!/usr/bin/env node
// Snapshot every revision of the sample PRD gist into this repo, so a page
// about how the PRD evolved can be built offline. Zero dependencies.
//
//   node scripts/fetch-gist-history.mjs [--gist <id>] [--out <repo root>] [--dry-run]
//
// Writes (idempotently):
//   content/gist/history/NN-<short>.md   the gist file at revision NN (1 = oldest), bytes verbatim
//   content/gist/history.json            per-revision date, +/- line counts, bytes, lines, URL + totals
//
// Requests: GET /gists/<id> for the history list, then GET /gists/<id>/<version>
// per revision, sequentially. Set GITHUB_TOKEN when the unauthenticated limit
// (60 requests/hour) is not enough; the token is only ever sent as a header.
//
// Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_GIST_ID, pickGistFile } from './lib/gist.mjs';
import {
  SNAPSHOT_FILE_RE,
  historyDocument,
  keepPreviousFetchedAt,
  lineEndingStyle,
  revisionsFromGist,
  snapshotName,
} from './lib/history.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0.0.0 Safari/537.36 prd-field-guide/fetch-gist-history';
const API = 'https://api.github.com';
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: node scripts/fetch-gist-history.mjs [--gist <id>] [--out <repo root>] [--dry-run]

  --gist <id>   gist id (default ${DEFAULT_GIST_ID})
  --out <dir>   repo root to write into (default: this script's repo root)
  --dry-run     fetch and validate, print the plan, write nothing
  -h, --help    show this help`;

class UsageError extends Error {}
class FetchError extends Error {}

function parseArgs(argv) {
  const opts = {
    gist: DEFAULT_GIST_ID,
    out: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
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
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]+$/i.test(opts.gist)) throw new UsageError(`--gist must be a hex gist id, got "${opts.gist}"`);
  return opts;
}

function apiHeaders() {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Optional: raises the unauthenticated 60 req/h limit. The value is never logged.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: apiHeaders() });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const when = reset ? ` until ${new Date(Number(reset) * 1000).toISOString()}` : '';
    throw new FetchError(
      `GET ${url} → HTTP ${res.status} (rate limited or forbidden${when}) — set GITHUB_TOKEN to raise the API limit`,
    );
  }
  if (!res.ok) throw new FetchError(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'follow' });
  if (!res.ok) throw new FetchError(`GET ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The named file at one revision, as bytes: API `content` unless truncated, then `raw_url`. */
async function fetchRevisionFile(id, rec, filename) {
  const label = `revision ${rec.n} (${rec.short})`;
  const revision = await fetchJson(`${API}/gists/${id}/${rec.version}`);
  const file = revision?.files?.[filename];
  if (!file) throw new FetchError(`${label}: no file named ${filename} in this revision`);
  if (file.truncated) {
    if (!file.raw_url) throw new FetchError(`${label}: ${filename} is truncated and has no raw_url`);
    return fetchBytes(file.raw_url, 'text/plain,*/*;q=0.8');
  }
  if (typeof file.content !== 'string') throw new FetchError(`${label}: ${filename} has no content`);
  return Buffer.from(file.content, 'utf8');
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

  const api = await fetchJson(`${API}/gists/${opts.gist}`);
  const file = pickGistFile(api);
  if (!file?.filename) throw new FetchError(`gist ${opts.gist} has no file to follow`);
  const filename = file.filename;
  const revisions = revisionsFromGist(api);
  if (revisions.length === 0) throw new FetchError(`gist ${opts.gist} has no history`);
  const owner = api.owner?.login ?? null;

  console.log(
    `gist ${api.id} (${owner}) — ${filename}, ${revisions.length} revision(s) ` +
      `${revisions[0].committed_at} → ${revisions.at(-1).committed_at}${opts.dryRun ? ' [dry run]' : ''}`,
  );

  // Sequential on purpose: ≤ 20 small requests, and it keeps the rate-limit math obvious.
  const snapshots = new Map();
  for (const rec of revisions) {
    const bytes = await fetchRevisionFile(api.id, rec, filename);
    validateSnapshot(rec, filename, bytes);
    snapshots.set(rec.version, bytes);
    console.log(
      `  ${String(rec.n).padStart(2, '0')}/${revisions.length} ${rec.short} ${rec.committed_at} ` +
        `+${rec.additions} -${rec.deletions} ${bytes.length} bytes ${lineEndingStyle(bytes)}`,
    );
  }

  // Report — never normalise — a revision whose line endings differ from the newest one.
  const newestStyle = lineEndingStyle(snapshots.get(revisions.at(-1).version));
  for (const rec of revisions) {
    const style = lineEndingStyle(snapshots.get(rec.version));
    if (style !== newestStyle) {
      console.error(`warning: revision ${rec.n} (${rec.short}) uses ${style} line endings, newest is ${newestStyle}`);
    }
  }

  const root = opts.out;
  const gistDir = path.join(root, 'content', 'gist');
  const historyDir = path.join(gistDir, 'history');
  const historyFile = path.join(gistDir, 'history.json');

  // Cross-check against the single-revision snapshot when both exist for the same revision.
  const meta = await readJsonIfExists(path.join(gistDir, 'meta.json'));
  const rawFile = path.join(root, 'public', 'raw', filename);
  const current = meta?.id === api.id ? revisions.find((r) => r.version === meta.revision) : null;
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
    await readJsonIfExists(historyFile),
    historyDocument({ id: api.id, owner, fetched_at: fetchedAt, revisions, files: snapshots }),
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
