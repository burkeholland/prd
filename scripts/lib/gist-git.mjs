// Thin I/O layer over the `git` binary for reading a gist's repository.
//
// A gist is a git repository: `git clone --no-checkout https://gist.github.com/<id>.git`
// is anonymous, is not the REST API and is not rate limited the way the API is.
// Everything the snapshot scripts need (revisions, dates, +/- counts, file bytes)
// comes from that clone. Every git call takes an args array — never a shell
// string — and can be replaced by an injected `run` for offline tests.
//
// The pure parsers (`normaliseDate`, `parseLog`, `parseNumstat`, `gistCloneUrl`)
// are exported so they can be tested without git at all.

import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const GIST_ID_RE = /^[0-9a-f]+$/i;
const OBJECT_ID_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const MAX_BUFFER = 64 * 1024 * 1024;

/** A git command exited non-zero (or could not be started). */
export class GitError extends Error {}

/** `https://gist.github.com/<id>.git` — the anonymous clone URL of a gist. */
export function gistCloneUrl(id) {
  if (!GIST_ID_RE.test(String(id ?? ''))) throw new GitError(`gist id must be hex, got ${JSON.stringify(id)}`);
  return `https://gist.github.com/${id}.git`;
}

/**
 * Default command runner: `git <args>` in `cwd`, resolving with stdout as a
 * Buffer (no text conversion — blobs pass through byte for byte). A non-zero
 * exit rejects with a GitError carrying git's stderr.
 */
export async function runGit(args, { cwd } = {}) {
  try {
    const { stdout } = await execFile('git', args, {
      cwd,
      encoding: 'buffer',
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
  } catch (err) {
    if (err?.code === 'ENOENT') throw new GitError('git is not installed or not on PATH');
    const stderr = Buffer.isBuffer(err?.stderr) ? err.stderr.toString('utf8').trim() : String(err?.stderr ?? '').trim();
    const exit = typeof err?.code === 'number' ? `exit ${err.code}` : (err?.code ?? err?.message ?? 'failed');
    throw new GitError(`git ${args.join(' ')} → ${exit}${stderr ? `: ${stderr}` : ''}`);
  }
}

function asBuffer(out) {
  if (Buffer.isBuffer(out)) return out;
  if (out instanceof Uint8Array) return Buffer.from(out);
  return Buffer.from(String(out ?? ''), 'utf8');
}

/** `2026-08-12T22:05:08-05:00` → `2026-08-13T03:05:08Z` (what the gist API prints). */
export function normaliseDate(iso) {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) throw new GitError(`not an ISO 8601 date: ${JSON.stringify(iso)}`);
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Lines of `git log --format=%H%x09%cI` → `[{ version, committed_at }]` in the given order. */
export function parseLog(text) {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => {
      const [version, date] = line.split('\t');
      if (!OBJECT_ID_RE.test(version ?? '')) throw new GitError(`unexpected git log line: ${JSON.stringify(line)}`);
      return { version, committed_at: normaliseDate(date) };
    });
}

/**
 * First line of `git diff --numstat` output (`added<TAB>deleted<TAB>path`) →
 * `{ additions, deletions }`. Binary files print `-` for both → 0/0; no
 * output at all (the file did not change) → 0/0.
 */
export function parseNumstat(text) {
  const line = String(text)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .find((l) => l.length > 0);
  if (!line) return { additions: 0, deletions: 0 };
  const [added, deleted] = line.split('\t');
  const toCount = (s) => {
    if (s === '-') return 0;
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n) || n < 0 || String(n) !== s) throw new GitError(`unexpected numstat line: ${JSON.stringify(line)}`);
    return n;
  };
  return { additions: toCount(added), deletions: toCount(deleted) };
}

/** `git clone --quiet --no-checkout https://gist.github.com/<id>.git <dir>`. */
export async function cloneGist(id, dir, { run = runGit } = {}) {
  await run(['clone', '--quiet', '--no-checkout', gistCloneUrl(id), dir]);
}

/** Every commit reachable from HEAD, oldest first: `[{ version, committed_at }]` (UTC, `Z`). */
export async function log(dir, { run = runGit } = {}) {
  return parseLog(asBuffer(await run(['log', '--reverse', '--format=%H%x09%cI'], { cwd: dir })).toString('utf8'));
}

/**
 * `{ additions, deletions }` of `file` between `parent` and `sha`. A root
 * commit has no parent: pass `null` and the commit's own numstat is used.
 */
export async function numstat(dir, parent, sha, file, { run = runGit } = {}) {
  const args = parent
    ? ['diff', '--numstat', parent, sha, '--', file]
    : ['show', '--numstat', '--format=', sha, '--', file];
  return parseNumstat(asBuffer(await run(args, { cwd: dir })).toString('utf8'));
}

/** The bytes of `file` at commit `sha`, verbatim (no line-ending or encoding conversion). */
export async function blob(dir, sha, file, { run = runGit } = {}) {
  return asBuffer(await run(['cat-file', 'blob', `${sha}:${file}`], { cwd: dir }));
}

/** The blob object id of `file` at commit `sha` (what gist raw URLs embed). */
export async function blobSha(dir, sha, file, { run = runGit } = {}) {
  const id = asBuffer(await run(['rev-parse', `${sha}:${file}`], { cwd: dir })).toString('utf8').trim();
  if (!OBJECT_ID_RE.test(id)) throw new GitError(`git rev-parse ${sha}:${file} did not return an object id (${JSON.stringify(id)})`);
  return id;
}

/** File names in the tree of commit `sha` (top level — gists are flat). */
export async function files(dir, sha, { run = runGit } = {}) {
  return asBuffer(await run(['ls-tree', '-z', '--name-only', sha], { cwd: dir }))
    .toString('utf8')
    .split('\0')
    .filter((name) => name.length > 0);
}

/**
 * Clone gist `id` into a fresh temporary directory, run `fn(dir)`, and remove
 * the directory again whatever happens. Resolves with `fn`'s result.
 */
export async function withGistClone(id, fn, { run = runGit, tmpdir = os.tmpdir() } = {}) {
  const dir = await mkdtemp(path.join(tmpdir, 'gist-'));
  try {
    await cloneGist(id, dir, { run });
    return await fn(dir);
  } finally {
    // Pack files are read-only on Windows; `force` + retries cover EPERM/EBUSY.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch((err) => {
      console.error(`warning: could not remove temporary clone ${dir}: ${err?.message ?? err}`);
    });
  }
}
