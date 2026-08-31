import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  GitError,
  blob,
  blobSha,
  cloneGist,
  files,
  gistCloneUrl,
  log,
  normaliseDate,
  numstat,
  parseLog,
  parseNumstat,
  runGit,
  withGistClone,
} from './gist-git.mjs';

const ID = 'f71d1156812fd91e4369308358892817';
const V1 = '2a8d004750914fbb98719b92f4c5ef76c5690591';
const V2 = 'aba7318a8e8b7bfeb134d7fc0bdf03b1412deef9';
const FILE = 'build-the-urlist.md';

/** A command runner that records every call and answers from a script. */
function fakeRun(answer) {
  const calls = [];
  const run = async (args, opts = {}) => {
    calls.push({ args, cwd: opts.cwd });
    const out = typeof answer === 'function' ? await answer(args, opts) : answer;
    return out;
  };
  return { run, calls };
}

test('normaliseDate: git offsets → the API\'s UTC `Z` form, `Z` input unchanged, garbage throws', () => {
  assert.equal(normaliseDate('2026-08-12T22:05:08-05:00'), '2026-08-13T03:05:08Z');
  assert.equal(normaliseDate('2026-08-31T08:11:39-05:00'), '2026-08-31T13:11:39Z');
  assert.equal(normaliseDate('2026-08-12T20:39:59Z'), '2026-08-12T20:39:59Z');
  assert.equal(normaliseDate('2026-01-01T00:30:00+01:00'), '2025-12-31T23:30:00Z', 'crosses a year boundary');
  assert.throws(() => normaliseDate('not a date'), GitError);
  assert.throws(() => normaliseDate(''), GitError);
  assert.throws(() => normaliseDate(undefined), GitError);
});

test('parseLog: tab-separated %H / %cI lines → { version, committed_at } in the given order', () => {
  const entries = parseLog(`${V1}\t2026-08-12T20:39:59Z\n${V2}\t2026-08-12T22:05:08-05:00\n`);
  assert.deepEqual(entries, [
    { version: V1, committed_at: '2026-08-12T20:39:59Z' },
    { version: V2, committed_at: '2026-08-13T03:05:08Z' },
  ]);
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog(`${V1}\t2026-08-12T20:39:59Z\r\n`), [{ version: V1, committed_at: '2026-08-12T20:39:59Z' }], 'CRLF tolerated');
  assert.throws(() => parseLog('nonsense\t2026-08-12T20:39:59Z'), GitError, 'a non-sha version throws');
  assert.throws(() => parseLog(`${V1}\tyesterday`), GitError, 'a non-date throws');
});

test('parseNumstat: added<TAB>deleted<TAB>path; binary `-` → 0; no output → 0/0', () => {
  assert.deepEqual(parseNumstat(`33\t2\t${FILE}\n`), { additions: 33, deletions: 2 });
  assert.deepEqual(parseNumstat(`790\t0\t${FILE}\n`), { additions: 790, deletions: 0 });
  assert.deepEqual(parseNumstat('-\t-\tmock.png\n'), { additions: 0, deletions: 0 });
  assert.deepEqual(parseNumstat(''), { additions: 0, deletions: 0 });
  assert.deepEqual(parseNumstat('\n'), { additions: 0, deletions: 0 });
  assert.deepEqual(parseNumstat(`\n12\t7\t${FILE}\n`), { additions: 12, deletions: 7 }, 'leading blank line skipped');
  assert.deepEqual(parseNumstat(`1\t5\t${FILE}\r\n`), { additions: 1, deletions: 5 }, 'CRLF tolerated');
  assert.throws(() => parseNumstat(`x\t5\t${FILE}`), GitError);
  assert.throws(() => parseNumstat(`-3\t5\t${FILE}`), GitError);
});

test('gistCloneUrl / cloneGist: anonymous https clone URL, --quiet --no-checkout, hex id only', async () => {
  assert.equal(gistCloneUrl(ID), `https://gist.github.com/${ID}.git`);
  assert.throws(() => gistCloneUrl('--upload-pack=evil'), GitError);
  assert.throws(() => gistCloneUrl(''), GitError);
  assert.throws(() => gistCloneUrl(undefined), GitError);

  const { run, calls } = fakeRun(Buffer.alloc(0));
  await cloneGist(ID, 'C:\\tmp\\gist-x', { run });
  assert.deepEqual(calls, [
    { args: ['clone', '--quiet', '--no-checkout', `https://gist.github.com/${ID}.git`, 'C:\\tmp\\gist-x'], cwd: undefined },
  ]);
  await assert.rejects(() => cloneGist('not-hex', 'dir', { run }), GitError);
  assert.equal(calls.length, 1, 'an invalid id never reaches git');
});

test('log: git log --reverse with %H/%cI, run in the clone, dates normalised', async () => {
  const { run, calls } = fakeRun(Buffer.from(`${V1}\t2026-08-12T20:39:59Z\n${V2}\t2026-08-12T22:05:08-05:00\n`));
  const entries = await log('/clone', { run });
  assert.deepEqual(calls, [{ args: ['log', '--reverse', '--format=%H%x09%cI'], cwd: '/clone' }]);
  assert.deepEqual(entries.map((e) => e.version), [V1, V2]);
  assert.deepEqual(entries.map((e) => e.committed_at), ['2026-08-12T20:39:59Z', '2026-08-13T03:05:08Z']);
});

test('numstat: diff --numstat parent..sha for a child, show --numstat for the root commit', async () => {
  const child = fakeRun(Buffer.from(`33\t2\t${FILE}\n`));
  assert.deepEqual(await numstat('/clone', V1, V2, FILE, { run: child.run }), { additions: 33, deletions: 2 });
  assert.deepEqual(child.calls, [{ args: ['diff', '--numstat', V1, V2, '--', FILE], cwd: '/clone' }]);

  const root = fakeRun(Buffer.from(`790\t0\t${FILE}\n`));
  assert.deepEqual(await numstat('/clone', null, V1, FILE, { run: root.run }), { additions: 790, deletions: 0 });
  assert.deepEqual(root.calls, [{ args: ['show', '--numstat', '--format=', V1, '--', FILE], cwd: '/clone' }]);

  const binary = fakeRun('-\t-\tmock.png\n');
  assert.deepEqual(await numstat('/clone', V1, V2, 'mock.png', { run: binary.run }), { additions: 0, deletions: 0 });
});

test('blob: cat-file blob <sha>:<file>, bytes returned verbatim (CRLF, non-UTF-8 and all)', async () => {
  const bytes = Buffer.concat([Buffer.from('# Title\r\n\r\nbody\r\n', 'utf8'), Buffer.from([0xff, 0xfe, 0x00])]);
  const { run, calls } = fakeRun(bytes);
  const out = await blob('/clone', V2, FILE, { run });
  assert.deepEqual(calls, [{ args: ['cat-file', 'blob', `${V2}:${FILE}`], cwd: '/clone' }]);
  assert.ok(Buffer.isBuffer(out));
  assert.ok(out.equals(bytes), 'no line-ending or encoding conversion');

  const fromArray = await blob('/clone', V2, FILE, { run: async () => new Uint8Array([0x23, 0x20]) });
  assert.ok(Buffer.isBuffer(fromArray) && fromArray.equals(Buffer.from('# ')));
});

test('blobSha: rev-parse <sha>:<file>, trimmed and validated', async () => {
  const sha = '82f6f039e6bbbc8d9799b1447c6eb2f427c064d7';
  const { run, calls } = fakeRun(Buffer.from(`${sha}\n`));
  assert.equal(await blobSha('/clone', 'HEAD', FILE, { run }), sha);
  assert.deepEqual(calls, [{ args: ['rev-parse', `HEAD:${FILE}`], cwd: '/clone' }]);
  await assert.rejects(() => blobSha('/clone', 'HEAD', FILE, { run: async () => Buffer.from('HEAD:nope\n') }), GitError);
});

test('files: ls-tree -z --name-only <sha> → names, NUL-separated', async () => {
  const { run, calls } = fakeRun(Buffer.from('build-the-urlist.md\0notes with space.txt\0'));
  assert.deepEqual(await files('/clone', V2, { run }), ['build-the-urlist.md', 'notes with space.txt']);
  assert.deepEqual(calls, [{ args: ['ls-tree', '-z', '--name-only', V2], cwd: '/clone' }]);
  assert.deepEqual(await files('/clone', V2, { run: async () => Buffer.alloc(0) }), []);
});

test('withGistClone: clones into a fresh temp dir, passes it to fn, removes it afterwards — even on failure', async () => {
  const tmpdir = os.tmpdir();
  const { run, calls } = fakeRun(Buffer.alloc(0));
  const exists = (p) => stat(p).then(() => true, () => false);

  let seen;
  const result = await withGistClone(ID, async (dir) => {
    seen = dir;
    assert.ok(await exists(dir), 'the temp dir exists while fn runs');
    assert.equal(path.dirname(dir), path.resolve(tmpdir));
    assert.ok(path.basename(dir).startsWith('gist-'));
    return 'ok';
  }, { run, tmpdir });
  assert.equal(result, 'ok');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 4), ['clone', '--quiet', '--no-checkout', `https://gist.github.com/${ID}.git`]);
  assert.equal(calls[0].args[4], seen, 'git clone targets the temp dir');
  assert.equal(await exists(seen), false, 'temp dir removed');

  let failedDir;
  await assert.rejects(
    () => withGistClone(ID, async (dir) => { failedDir = dir; throw new Error('boom'); }, { run, tmpdir }),
    /boom/,
  );
  assert.equal(await exists(failedDir), false, 'temp dir removed when fn throws');
  assert.notEqual(failedDir, seen, 'each call gets a fresh directory');

  const cloneFails = async () => { throw new GitError('git clone → exit 128: fatal: repository not found'); };
  await assert.rejects(() => withGistClone(ID, async () => 'never', { run: cloneFails, tmpdir }), GitError);
  const leftovers = (await readdir(tmpdir)).filter((f) => f === path.basename(seen) || f === path.basename(failedDir));
  assert.deepEqual(leftovers, []);
});

test('runGit: a non-zero git exit rejects with a GitError that names the command', async () => {
  const version = await runGit(['--version']);
  assert.ok(Buffer.isBuffer(version));
  assert.match(version.toString('utf8'), /^git version /);

  await assert.rejects(
    () => runGit(['cat-file', '-p', 'deadbeef'], { cwd: os.tmpdir() }),
    (err) => err instanceof GitError && /git cat-file -p deadbeef → exit \d+/.test(err.message),
  );
});
