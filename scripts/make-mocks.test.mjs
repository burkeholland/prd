import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WIDTHS, derivedName, derivedNames, isUpToDate, makeMocks } from './make-mocks.mjs';

test('derivedName: <stem>.png → <stem>-<width>.webp, both widths in order', () => {
  assert.equal(derivedName('01-home-page.png', 760), '01-home-page-760.webp');
  assert.equal(derivedName('01-home-page.png', 1320), '01-home-page-1320.webp');
  assert.equal(derivedName('07-published-list-qr-code.PNG', 760), '07-published-list-qr-code-760.webp', 'extension case-insensitive');
  assert.deepEqual(WIDTHS, [760, 1320]);
  assert.deepEqual(derivedNames('05-my-lists-logged-in.png'), [
    '05-my-lists-logged-in-760.webp',
    '05-my-lists-logged-in-1320.webp',
  ]);
});

test('isUpToDate: skip only a derived file that exists and is not older than its source; --force never skips', () => {
  assert.equal(isUpToDate(2000, 1000), true, 'newer than source → up to date');
  assert.equal(isUpToDate(1000, 1000), true, 'same mtime → up to date');
  assert.equal(isUpToDate(999, 1000), false, 'older than source (re-fetched PNG) → rebuild');
  assert.equal(isUpToDate(null, 1000), false, 'missing derived file → build');
  assert.equal(isUpToDate(undefined, 1000), false);
  assert.equal(isUpToDate(2000, 1000, { force: true }), false, '--force rebuilds an up-to-date file');
  assert.equal(isUpToDate(null, 1000, { force: true }), false);
});

test('makeMocks: one PNG in a temp dir → two WebP files; the second run writes nothing; a touched source rebuilds', async () => {
  const { default: sharp } = await import('sharp');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'make-mocks-'));
  try {
    const src = path.join(dir, 'mocks');
    const out = path.join(src, 'derived');
    await mkdir(src, { recursive: true });
    await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 30, g: 30, b: 30 } } })
      .png()
      .toFile(path.join(src, 'x.png'));

    const lines = [];
    const first = await makeMocks({ src, out, log: (line) => lines.push(line) });
    assert.deepEqual(first.sources, ['x.png']);
    assert.equal(first.written.length, 2);
    assert.deepEqual(first.upToDate, []);
    assert.deepEqual(first.missing, []);
    assert.deepEqual((await readdir(out)).sort(), ['x-1320.webp', 'x-760.webp']);
    assert.equal(lines.length, 2, 'one line per derived file');
    assert.match(lines[0], /^written .*x-760\.webp \d+ bytes$/);
    assert.match(lines[1], /^written .*x-1320\.webp \d+ bytes$/);
    // withoutEnlargement: a 100 px source stays 100 px wide. (Read into memory first: on Windows
    // libvips keeps a file it opened mapped for a while, which would make the cleanup EBUSY.)
    const meta = await sharp(await readFile(path.join(out, 'x-1320.webp'))).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, 100);
    assert.equal(meta.height, 100);
    assert.deepEqual(await readdir(src).then((files) => files.sort()), ['derived', 'x.png'], 'nothing else written next to the source');

    const before = await Promise.all(['x-760.webp', 'x-1320.webp'].map((f) => stat(path.join(out, f))));
    const second = await makeMocks({ src, out, log: (line) => lines.push(line) });
    assert.deepEqual(second.written, [], 'second run writes nothing');
    assert.equal(second.upToDate.length, 2);
    assert.deepEqual(second.missing, []);
    assert.equal(lines.length, 4);
    assert.match(lines[2], /^up to date .*x-760\.webp \d+ bytes$/);
    assert.match(lines[3], /^up to date .*x-1320\.webp \d+ bytes$/);
    const after = await Promise.all(['x-760.webp', 'x-1320.webp'].map((f) => stat(path.join(out, f))));
    assert.deepEqual(after.map((s) => s.mtimeMs), before.map((s) => s.mtimeMs), 'derived files untouched');

    // A re-fetched source (newer mtime) is derived again; --force rebuilds regardless.
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(src, 'x.png'), later, later);
    const third = await makeMocks({ src, out, log: () => {} });
    assert.equal(third.written.length, 2, 'newer source → both copies rewritten');
    const fourth = await makeMocks({ src, out, force: true, log: () => {} });
    assert.equal(fourth.written.length, 2, '--force → both copies rewritten');
    assert.deepEqual(fourth.missing, []);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
