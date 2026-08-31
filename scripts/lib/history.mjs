// Pure helpers for snapshotting every revision of a GitHub gist (its "history").
// No I/O and no dependencies beyond the language, so everything here is unit
// testable offline (see history.test.mjs). The I/O lives in
// scripts/fetch-gist-history.mjs.

const SHORT_LENGTH = 7;

/** Gist web URL of one revision: `https://gist.github.com/<owner>/<id>/<version>`. */
export function revisionUrl(owner, id, version) {
  return owner ? `https://gist.github.com/${owner}/${id}/${version}` : `https://gist.github.com/${id}/${version}`;
}

/**
 * The commits of the gist's git repository (`entries` = `[{ version, committed_at }]`
 * oldest → newest, as `git log --reverse` lists them) turned into records
 * numbered `n` = 1..N: `{ n, version, short, committed_at, additions, deletions, total, url }`.
 * `counts` maps each version (Map or plain object) to its `{ additions, deletions }`
 * from `git diff --numstat`; git has them for every revision, the root commit
 * included, so a missing entry is a caller bug and throws.
 */
export function revisionsFromLog(entries, counts, { id = null, owner = null } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const lookup = (version) => (counts instanceof Map ? counts.get(version) : counts?.[version]);

  return list.map((entry, index) => {
    const version = String(entry?.version ?? '');
    const status = lookup(version);
    if (!status || !Number.isFinite(status.additions) || !Number.isFinite(status.deletions)) {
      throw new Error(`revisionsFromLog: no line counts for revision ${index + 1} (${version})`);
    }
    return {
      n: index + 1,
      version,
      short: version.slice(0, SHORT_LENGTH),
      committed_at: entry?.committed_at ?? null,
      additions: status.additions,
      deletions: status.deletions,
      total: status.additions + status.deletions,
      url: revisionUrl(owner, id, version),
    };
  });
}

/** `{ n: 7, short: '8ef29d7' }` → `history/07-8ef29d7.md` (relative to content/gist/). */
export function snapshotName(rec) {
  return `history/${String(rec.n).padStart(2, '0')}-${rec.short}.md`;
}

/** Matches the basename of a snapshot file, e.g. `07-8ef29d7.md`. */
export const SNAPSHOT_FILE_RE = /^\d{2}-[0-9a-f]{7}\.md$/;

function toBytes(snapshot) {
  if (typeof snapshot === 'string') return Buffer.from(snapshot, 'utf8');
  if (snapshot instanceof ArrayBuffer) return Buffer.from(snapshot);
  return Buffer.isBuffer(snapshot) ? snapshot : Buffer.from(snapshot);
}

/**
 * `{ bytes, lines }` of one snapshot. `lines` is the number of `\n` plus one
 * when the last line is unterminated (an empty snapshot has 0 lines).
 */
export function snapshotStats(snapshot) {
  const buf = toBytes(snapshot);
  let newlines = 0;
  for (const b of buf) if (b === 0x0a) newlines++;
  const unterminated = buf.length > 0 && buf[buf.length - 1] !== 0x0a;
  return { bytes: buf.length, lines: newlines + (unterminated ? 1 : 0) };
}

/**
 * Line-ending style of a snapshot: `crlf`, `lf`, `mixed`, or `none` (no line
 * break at all). Used to report — never to normalise — what was fetched.
 */
export function lineEndingStyle(snapshot) {
  const buf = toBytes(snapshot);
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0x0a) continue;
    if (i > 0 && buf[i - 1] === 0x0d) crlf++;
    else lf++;
  }
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'crlf' : 'lf';
}

function lookupSnapshot(files, rec) {
  if (files instanceof Map) return files.get(rec.version) ?? files.get(rec.n);
  return files?.[rec.version] ?? files?.[rec.n];
}

/**
 * The `content/gist/history.json` object. `revisions` are the records from
 * revisionsFromLog (oldest → newest); `files` maps each `version` (or `n`)
 * to the snapshot bytes/text of that revision.
 */
export function historyDocument({ id, owner, fetched_at, revisions, files }) {
  const list = revisions ?? [];
  const entries = list.map((rec) => {
    const snapshot = lookupSnapshot(files, rec);
    if (snapshot === undefined || snapshot === null) {
      throw new Error(`historyDocument: no snapshot for revision ${rec.n} (${rec.version})`);
    }
    const { bytes, lines } = snapshotStats(snapshot);
    return { ...rec, file: snapshotName(rec), bytes, lines };
  });
  return {
    id: id ?? null,
    owner: owner ?? null,
    fetched_at: fetched_at instanceof Date ? fetched_at.toISOString() : fetched_at ?? null,
    count: entries.length,
    first_committed_at: entries[0]?.committed_at ?? null,
    last_committed_at: entries.at(-1)?.committed_at ?? null,
    additions_total: entries.reduce((sum, r) => sum + r.additions, 0),
    deletions_total: entries.reduce((sum, r) => sum + r.deletions, 0),
    revisions: entries,
  };
}

/**
 * Idempotency rule shared with fetch-gist.mjs: when `prevDoc` (the document
 * already on disk, parsed) differs from `nextDoc` only in `fetched_at`, keep
 * the previous stamp so a rerun writes nothing. Returns `nextDoc` otherwise.
 */
export function keepPreviousFetchedAt(prevDoc, nextDoc) {
  if (!prevDoc || typeof prevDoc !== 'object' || typeof prevDoc.fetched_at !== 'string') return nextDoc;
  const strip = (doc) => JSON.stringify({ ...doc, fetched_at: null });
  if (strip(prevDoc) !== strip(nextDoc)) return nextDoc;
  return { ...nextDoc, fetched_at: prevDoc.fetched_at };
}
