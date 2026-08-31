import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SNAPSHOT_FILE_RE,
  historyDocument,
  keepPreviousFetchedAt,
  lineEndingStyle,
  revisionUrl,
  revisionsFromLog,
  snapshotName,
  snapshotStats,
} from './history.mjs';

const ID = 'f71d1156812fd91e4369308358892817';
const V1 = '2a8d004750914fbb98719b92f4c5ef76c5690591';
const V2 = 'f3d7c70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const V3 = '8ef29d7eecb97ecbbd5a89ff4a7375482364704f';

// Oldest first, exactly as `git log --reverse` lists it (dates already normalised to UTC).
const LOG_FIXTURE = [
  { version: V1, committed_at: '2026-08-12T20:39:59Z' },
  { version: V2, committed_at: '2026-08-15T14:42:40Z' },
  { version: V3, committed_at: '2026-08-31T13:11:39Z' },
];
// `git diff --numstat` per version; the root commit has real counts too.
const COUNTS = new Map([
  [V1, { additions: 790, deletions: 0 }],
  [V2, { additions: 125, deletions: 79 }],
  [V3, { additions: 1, deletions: 5 }],
]);
const GIST = { id: ID, owner: 'burkeholland' };
const revisions = () => revisionsFromLog(LOG_FIXTURE, COUNTS, GIST);

test('revisionsFromLog: log order kept (oldest → newest), numbered 1..N, counts from numstat incl. the root', () => {
  const revs = revisions();
  assert.equal(revs.length, 3);
  assert.deepEqual(revs.map((r) => r.n), [1, 2, 3]);
  assert.deepEqual(revs.map((r) => r.version), [V1, V2, V3]);
  assert.deepEqual(revs.map((r) => r.short), ['2a8d004', 'f3d7c70', '8ef29d7']);
  assert.deepEqual(
    revs.map((r) => r.committed_at),
    ['2026-08-12T20:39:59Z', '2026-08-15T14:42:40Z', '2026-08-31T13:11:39Z'],
  );
  assert.deepEqual(revs[0], {
    n: 1,
    version: V1,
    short: '2a8d004',
    committed_at: '2026-08-12T20:39:59Z',
    additions: 790,
    deletions: 0,
    total: 790,
    url: `https://gist.github.com/burkeholland/${ID}/${V1}`,
  });
  assert.deepEqual([revs[1].additions, revs[1].deletions, revs[1].total], [125, 79, 204]);
  assert.deepEqual([revs[2].additions, revs[2].deletions, revs[2].total], [1, 5, 6]);
  assert.deepEqual(Object.keys(revs[2]), ['n', 'version', 'short', 'committed_at', 'additions', 'deletions', 'total', 'url']);

  const fromObject = revisionsFromLog(LOG_FIXTURE, Object.fromEntries(COUNTS), GIST);
  assert.deepEqual(fromObject, revs, 'counts as a plain object work too');
});

test('revisionsFromLog: empty log → [], url without owner when anonymous, missing counts throw', () => {
  assert.deepEqual(revisionsFromLog([], new Map(), GIST), []);
  assert.deepEqual(revisionsFromLog(undefined, undefined, GIST), []);
  assert.equal(revisionUrl(null, ID, V1), `https://gist.github.com/${ID}/${V1}`);
  const [rev] = revisionsFromLog(LOG_FIXTURE.slice(0, 1), COUNTS, { id: ID, owner: null });
  assert.equal(rev.url, `https://gist.github.com/${ID}/${V1}`);
  assert.throws(() => revisionsFromLog(LOG_FIXTURE, new Map([[V1, COUNTS.get(V1)]]), GIST), /no line counts for revision 2/);
  assert.throws(() => revisionsFromLog(LOG_FIXTURE, new Map([...COUNTS, [V2, { additions: 'x' }]]), GIST), /revision 2/);
});

test('revisionsFromLog: equal timestamps keep the log order (no re-sorting by date)', () => {
  const same = '2026-08-13T15:00:00Z';
  const log = [
    { version: 'a'.repeat(40), committed_at: same },
    { version: 'b'.repeat(40), committed_at: same },
    { version: 'c'.repeat(40), committed_at: same },
  ];
  const counts = Object.fromEntries(log.map((e) => [e.version, { additions: 1, deletions: 1 }]));
  assert.deepEqual(revisionsFromLog(log, counts, GIST).map((r) => r.short), ['aaaaaaa', 'bbbbbbb', 'ccccccc']);
});

test('snapshotName: history/NN-<short>.md, zero-padded', () => {
  assert.equal(snapshotName({ n: 7, short: '8ef29d7' }), 'history/07-8ef29d7.md');
  assert.equal(snapshotName(revisions()[0]), 'history/01-2a8d004.md');
  assert.equal(snapshotName({ n: 12, short: 'abcdef0' }), 'history/12-abcdef0.md');
  assert.ok(SNAPSHOT_FILE_RE.test('07-8ef29d7.md'));
  assert.ok(!SNAPSHOT_FILE_RE.test('history.json'));
  assert.ok(!SNAPSHOT_FILE_RE.test('7-8ef29d7.md'));
});

test('snapshotStats / lineEndingStyle: bytes, lines (+1 when unterminated), style never normalised', () => {
  assert.deepEqual(snapshotStats('# T\r\n\r\nbody\r\n'), { bytes: 13, lines: 3 });
  assert.deepEqual(snapshotStats('# T\r\n\r\nbody.'), { bytes: 12, lines: 3 });
  assert.deepEqual(snapshotStats('# T\n\nbody\n'), { bytes: 10, lines: 3 });
  assert.deepEqual(snapshotStats(Buffer.from('# T\n\nbody')), { bytes: 9, lines: 3 });
  assert.deepEqual(snapshotStats(''), { bytes: 0, lines: 0 });
  assert.deepEqual(snapshotStats('no newline'), { bytes: 10, lines: 1 });
  assert.equal(snapshotStats('héllo\n').bytes, 7, 'bytes, not characters');

  assert.equal(lineEndingStyle('a\r\nb\r\n'), 'crlf');
  assert.equal(lineEndingStyle('a\nb\n'), 'lf');
  assert.equal(lineEndingStyle('a\r\nb\n'), 'mixed');
  assert.equal(lineEndingStyle('a'), 'none');
  assert.equal(lineEndingStyle(Buffer.from('a\r\nb')), 'crlf');
});

const SNAPSHOTS = new Map([
  [V1, '# Build The Urlist\r\n\r\nfirst draft\r\n'],
  [V2, Buffer.from('# Build The Urlist\r\n\r\nsecond draft, longer\r\n\r\nmore\r\n')],
  [V3, '# Build The Urlist\r\n\r\nfinal draft.'],
]);

test('historyDocument: totals, count, first/last, per-revision file/bytes/lines', () => {
  const doc = historyDocument({
    id: ID,
    owner: 'burkeholland',
    fetched_at: '2026-08-31T18:00:00.000Z',
    revisions: revisions(),
    files: SNAPSHOTS,
  });
  assert.deepEqual(Object.keys(doc), [
    'id', 'owner', 'fetched_at', 'count', 'first_committed_at', 'last_committed_at',
    'additions_total', 'deletions_total', 'revisions',
  ]);
  assert.equal(doc.id, ID);
  assert.equal(doc.owner, 'burkeholland');
  assert.equal(doc.fetched_at, '2026-08-31T18:00:00.000Z');
  assert.equal(doc.count, 3);
  assert.equal(doc.first_committed_at, '2026-08-12T20:39:59Z');
  assert.equal(doc.last_committed_at, '2026-08-31T13:11:39Z');
  assert.equal(doc.additions_total, 916, 'the root commit counts too');
  assert.equal(doc.deletions_total, 84);
  assert.deepEqual(doc.revisions.map((r) => r.file), ['history/01-2a8d004.md', 'history/02-f3d7c70.md', 'history/03-8ef29d7.md']);
  assert.deepEqual(doc.revisions.map((r) => r.bytes), [35, 52, 34]);
  assert.deepEqual(doc.revisions.map((r) => r.lines), [3, 5, 3]);
  assert.deepEqual(Object.keys(doc.revisions[0]), [
    'n', 'version', 'short', 'committed_at', 'additions', 'deletions', 'total', 'url', 'file', 'bytes', 'lines',
  ]);
  assert.equal(doc.revisions[0].additions, 790, 'record fields are carried over');

  const fromObject = historyDocument({ id: ID, owner: 'x', fetched_at: new Date('2026-01-02T03:04:05Z'), revisions: revisions(), files: Object.fromEntries(SNAPSHOTS) });
  assert.equal(fromObject.fetched_at, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(fromObject.revisions.map((r) => r.bytes), [35, 52, 34]);
});

test('historyDocument: empty history → zero totals and null dates; missing snapshot throws', () => {
  const empty = historyDocument({ id: ID, owner: null, fetched_at: 'x', revisions: [], files: new Map() });
  assert.equal(empty.count, 0);
  assert.equal(empty.first_committed_at, null);
  assert.equal(empty.last_committed_at, null);
  assert.equal(empty.additions_total, 0);
  assert.equal(empty.deletions_total, 0);
  assert.deepEqual(empty.revisions, []);
  assert.throws(
    () => historyDocument({ id: ID, owner: 'x', fetched_at: 'x', revisions: revisions(), files: new Map() }),
    /no snapshot for revision 1/,
  );
});

test('keepPreviousFetchedAt: keeps the old stamp on identical content, takes the new one otherwise', () => {
  const make = (fetched_at, files = SNAPSHOTS) => historyDocument({ id: ID, owner: 'burkeholland', fetched_at, revisions: revisions(), files });
  const prev = make('2026-08-31T18:00:00.000Z');
  const next = make('2026-08-31T19:00:00.000Z');

  const kept = keepPreviousFetchedAt(prev, next);
  assert.equal(kept.fetched_at, '2026-08-31T18:00:00.000Z');
  assert.deepEqual(kept, prev, 'identical content → identical document');
  assert.equal(JSON.stringify(kept), JSON.stringify(prev), 'byte-identical JSON, so nothing gets rewritten');

  const changed = new Map(SNAPSHOTS);
  changed.set(V3, '# Build The Urlist\r\n\r\nfinal draft, edited.');
  const differs = keepPreviousFetchedAt(prev, make('2026-08-31T19:00:00.000Z', changed));
  assert.equal(differs.fetched_at, '2026-08-31T19:00:00.000Z', 'a changed revision takes the new stamp');

  const more = historyDocument({
    id: ID,
    owner: 'burkeholland',
    fetched_at: '2026-08-31T19:00:00.000Z',
    revisions: revisionsFromLog(LOG_FIXTURE.slice(1), COUNTS, GIST),
    files: new Map([[V2, SNAPSHOTS.get(V2)], [V3, SNAPSHOTS.get(V3)]]),
  });
  assert.equal(keepPreviousFetchedAt(prev, more).fetched_at, '2026-08-31T19:00:00.000Z', 'a different count takes the new stamp');

  const recounted = new Map(COUNTS);
  recounted.set(V1, { additions: 0, deletions: 0 });
  const counts = historyDocument({ id: ID, owner: 'burkeholland', fetched_at: '2026-08-31T19:00:00.000Z', revisions: revisionsFromLog(LOG_FIXTURE, recounted, GIST), files: SNAPSHOTS });
  assert.equal(keepPreviousFetchedAt(prev, counts).fetched_at, '2026-08-31T19:00:00.000Z', 'changed +/- counts take the new stamp');

  assert.equal(keepPreviousFetchedAt(null, next), next, 'no previous document');
  assert.equal(keepPreviousFetchedAt(undefined, next), next);
  assert.equal(keepPreviousFetchedAt({ ...prev, fetched_at: 42 }, next), next, 'previous stamp not a string');
});

// ---------------------------------------------------------------------------
// Integration: checks the committed data produced by `node scripts/fetch-gist-history.mjs`.
// Skips cleanly when the outputs have not been generated.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('integration: committed history is complete, byte-exact, and matches the current snapshot', async (t) => {
  const gistDir = path.join(ROOT, 'content', 'gist');
  const historyFile = path.join(gistDir, 'history.json');
  const historyDir = path.join(gistDir, 'history');
  const exists = async (p) => stat(p).then(() => true, () => false);
  if (!(await exists(historyFile)) || !(await exists(historyDir))) {
    t.skip('history not generated yet — run `node scripts/fetch-gist-history.mjs`');
    return;
  }

  const doc = JSON.parse(await readFile(historyFile, 'utf8'));
  const files = (await readdir(historyDir)).filter((f) => f.endsWith('.md')).sort();
  assert.ok(files.every((f) => SNAPSHOT_FILE_RE.test(f)), 'only NN-<short>.md files in content/gist/history/');
  assert.equal(doc.count, files.length, 'count equals the number of snapshot files');
  assert.equal(doc.revisions.length, doc.count);
  assert.deepEqual(doc.revisions.map((r) => path.basename(r.file)), files, 'listed files are exactly the files on disk, in order');
  assert.deepEqual(doc.revisions.map((r) => r.n), files.map((_, i) => i + 1));
  assert.equal(doc.first_committed_at, doc.revisions[0].committed_at);
  assert.equal(doc.last_committed_at, doc.revisions.at(-1).committed_at);
  assert.equal(doc.additions_total, doc.revisions.reduce((s, r) => s + r.additions, 0));
  assert.equal(doc.deletions_total, doc.revisions.reduce((s, r) => s + r.deletions, 0));
  assert.ok(!Number.isNaN(Date.parse(doc.fetched_at)), 'fetched_at is a date');

  let previous = 0;
  for (const rec of doc.revisions) {
    assert.match(rec.version, /^[0-9a-f]{40}$/);
    assert.equal(rec.short, rec.version.slice(0, 7));
    assert.equal(rec.file, snapshotName(rec));
    assert.equal(rec.url, `https://gist.github.com/${doc.owner}/${doc.id}/${rec.version}`);
    const at = Date.parse(rec.committed_at);
    assert.ok(at >= previous, `revision ${rec.n} is not older than revision ${rec.n - 1}`);
    previous = at;
    const bytes = await readFile(path.join(gistDir, rec.file));
    assert.equal(bytes.length, rec.bytes, `${rec.file} has the recorded byte count`);
    assert.deepEqual(snapshotStats(bytes), { bytes: rec.bytes, lines: rec.lines }, `${rec.file} has the recorded line count`);
    assert.ok(bytes.toString('utf8').startsWith('# '), `${rec.file} starts with the h1`);
  }

  const metaFile = path.join(gistDir, 'meta.json');
  const rawFile = path.join(ROOT, 'public', 'raw', 'build-the-urlist.md');
  if (!(await exists(metaFile)) || !(await exists(rawFile))) {
    t.diagnostic('meta.json / public/raw snapshot absent — byte-identity check skipped');
    return;
  }
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  assert.equal(meta.id, doc.id, 'history.json and meta.json describe the same gist');
  const current = doc.revisions.find((r) => r.version === meta.revision);
  assert.ok(current, `meta.json revision ${meta.revision} is in the history`);
  const raw = await readFile(rawFile);
  const snapshot = await readFile(path.join(gistDir, current.file));
  assert.ok(snapshot.equals(raw), `${current.file} is byte-identical to public/raw/build-the-urlist.md`);
});
