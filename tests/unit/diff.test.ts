import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffLines, hunkHeader, hunks, lineEndings, lines, normalise, summary, type Op } from '../../src/lib/diff';

const types = (ops: Op[]) => ops.map((op) => op.type);
const texts = (ops: Op[], type: Op['type']) => ops.filter((op) => op.type === type).map((op) => op.text);

describe('normalise', () => {
  it('turns CRLF into LF', () => {
    expect(normalise('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('drops the newline that ends the last line, so a trailing newline is not a line', () => {
    expect(normalise('a\nb\n')).toBe('a\nb');
    expect(normalise('a\r\nb\r\n')).toBe('a\nb');
    expect(normalise('a\n\n\n')).toBe('a');
    expect(normalise('')).toBe('');
    expect(normalise('\r\n')).toBe('');
  });

  it('is idempotent', () => {
    const once = normalise('x\r\n\r\ny\r\n');
    expect(normalise(once)).toBe(once);
  });

  it('splits into lines the same way regardless of the ending style', () => {
    expect(lines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(lines('a\nb')).toEqual(['a', 'b']);
    expect(lines('a\n\nb\n')).toEqual(['a', '', 'b']);
    expect(lines('')).toEqual([]);
  });
});

describe('diffLines', () => {
  it('reports identical inputs as all equal with matching line numbers', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(ops).toEqual([
      { type: 'equal', text: 'a', aLine: 1, bLine: 1 },
      { type: 'equal', text: 'b', aLine: 2, bLine: 2 },
      { type: 'equal', text: 'c', aLine: 3, bLine: 3 },
    ]);
    expect(summary(ops)).toEqual({ added: 0, deleted: 0 });
  });

  it('handles empty inputs', () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines([], ['a', 'b'])).toEqual([
      { type: 'add', text: 'a', bLine: 1 },
      { type: 'add', text: 'b', bLine: 2 },
    ]);
    expect(diffLines(['a', 'b'], [])).toEqual([
      { type: 'del', text: 'a', aLine: 1 },
      { type: 'del', text: 'b', aLine: 2 },
    ]);
  });

  it('finds an insertion', () => {
    const ops = diffLines(['a', 'b', 'c'], ['a', 'b', 'x', 'c']);
    expect(types(ops)).toEqual(['equal', 'equal', 'add', 'equal']);
    expect(ops[2]).toEqual({ type: 'add', text: 'x', bLine: 3 });
    expect(ops[3]).toEqual({ type: 'equal', text: 'c', aLine: 3, bLine: 4 });
  });

  it('finds a deletion', () => {
    const ops = diffLines(['a', 'b', 'x', 'c'], ['a', 'b', 'c']);
    expect(types(ops)).toEqual(['equal', 'equal', 'del', 'equal']);
    expect(ops[2]).toEqual({ type: 'del', text: 'x', aLine: 3 });
    expect(ops[3]).toEqual({ type: 'equal', text: 'c', aLine: 4, bLine: 3 });
  });

  it('emits the deleted lines before the added ones in a replaced block', () => {
    const ops = diffLines(['a', 'old 1', 'old 2', 'z'], ['a', 'new 1', 'new 2', 'new 3', 'z']);
    expect(types(ops)).toEqual(['equal', 'del', 'del', 'add', 'add', 'add', 'equal']);
    expect(texts(ops, 'del')).toEqual(['old 1', 'old 2']);
    expect(texts(ops, 'add')).toEqual(['new 1', 'new 2', 'new 3']);
    expect(summary(ops)).toEqual({ added: 3, deleted: 2 });
  });

  it('never interleaves adds and dels inside one changed block', () => {
    const ops = diffLines(['x', 'c', 'y', 'd', 'e'], ['c', 'x', 'd', 'q', 'e', 'r']);
    let previous: Op['type'] = 'equal';
    for (const op of ops) {
      expect(!(previous === 'add' && op.type === 'del'), `del after add: ${types(ops).join(' ')}`).toBe(true);
      previous = op.type;
    }
    expect(texts(ops, 'equal')).toEqual(['c', 'd', 'e']); // one longest common subsequence
  });

  it('accepts raw strings and normalises them before diffing', () => {
    const ops = diffLines('a\r\nb\r\n', 'a\nb\nc\n');
    expect(types(ops)).toEqual(['equal', 'equal', 'add']);
    expect(diffLines('a\r\nb\r\n', 'a\nb')).toEqual(diffLines(['a', 'b'], ['a', 'b']));
  });
});

describe('hunks', () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);

  it('wraps a single change in `context` equal lines with a unified header', () => {
    const after = before.map((line) => (line === 'line 10' ? 'changed 10' : line));
    const result = hunks(diffLines(before, after));
    expect(result).toHaveLength(1);
    const [hunk] = result;
    expect(hunk).toMatchObject({ aStart: 7, aCount: 7, bStart: 7, bCount: 7 });
    expect(types(hunk!.ops)).toEqual(['equal', 'equal', 'equal', 'del', 'add', 'equal', 'equal', 'equal']);
    expect(hunkHeader(hunk!)).toBe('@@ -7,7 +7,7 @@');
  });

  it('merges changes whose context overlaps or touches and keeps the rest apart', () => {
    // Changes at old lines 5 and 12: six equal lines between them → one hunk with context 3.
    const touching = before.map((line) => (line === 'line 5' || line === 'line 12' ? `${line} edited` : line));
    expect(hunks(diffLines(before, touching), 3)).toHaveLength(1);
    // Seven equal lines between → two hunks.
    const apart = before.map((line) => (line === 'line 5' || line === 'line 13' ? `${line} edited` : line));
    const two = hunks(diffLines(before, apart), 3);
    expect(two).toHaveLength(2);
    expect(two.map(hunkHeader)).toEqual(['@@ -2,7 +2,7 @@', '@@ -10,7 +10,7 @@']);
    // With more context the same pair merges.
    expect(hunks(diffLines(before, apart), 4)).toHaveLength(1);
  });

  it('clips context at the start and end of the file', () => {
    const after = ['new first', ...before.slice(0, 29), 'new last'];
    const result = hunks(diffLines(before, after), 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ aStart: 1, aCount: 2, bStart: 1, bCount: 3 });
    expect(types(result[0]!.ops)).toEqual(['add', 'equal', 'equal']);
    expect(result[1]).toMatchObject({ aStart: 28, aCount: 3, bStart: 29, bCount: 3 });
    expect(types(result[1]!.ops)).toEqual(['equal', 'equal', 'del', 'add']);
  });

  it('numbers a pure insertion or deletion like diff -U does', () => {
    const inserted = hunks(diffLines(['a', 'b'], ['a', 'x', 'b']), 0);
    expect(inserted).toHaveLength(1);
    expect(hunkHeader(inserted[0]!)).toBe('@@ -1,0 +2,1 @@');
    const removed = hunks(diffLines(['a', 'x', 'b'], ['a', 'b']), 0);
    expect(hunkHeader(removed[0]!)).toBe('@@ -2,1 +1,0 @@');
    expect(hunks(diffLines([], ['a']), 3).map(hunkHeader)).toEqual(['@@ -0,0 +1,1 @@']);
  });

  it('returns no hunks when nothing changed', () => {
    expect(hunks(diffLines(before, before))).toEqual([]);
    expect(hunks([])).toEqual([]);
  });
});

describe('summary', () => {
  it('counts add and del ops only', () => {
    const ops: Op[] = [
      { type: 'equal', text: 'a', aLine: 1, bLine: 1 },
      { type: 'del', text: 'b', aLine: 2 },
      { type: 'del', text: 'c', aLine: 3 },
      { type: 'add', text: 'd', bLine: 2 },
    ];
    expect(summary(ops)).toEqual({ added: 1, deleted: 2 });
    expect(summary([])).toEqual({ added: 0, deleted: 0 });
  });
});

describe('lineEndings', () => {
  it('classifies CRLF, LF, mixed and none', () => {
    expect(lineEndings('a\r\nb\r\n')).toBe('CRLF');
    expect(lineEndings('a\nb\n')).toBe('LF');
    expect(lineEndings('a\r\nb\nc')).toBe('mixed');
    expect(lineEndings('no newline')).toBe('none');
    expect(lineEndings('')).toBe('none');
    expect(lineEndings('\n')).toBe('LF');
  });
});

describe('the real gist history', () => {
  const HISTORY = resolve('content/gist/history.json');
  const available = existsSync(HISTORY);

  it.skipIf(!available)('diffs every consecutive snapshot pair at the text level', () => {
    const history = JSON.parse(readFileSync(HISTORY, 'utf8')) as {
      count: number;
      revisions: { n: number; file: string; additions: number; deletions: number }[];
    };
    const ordered = [...history.revisions].sort((a, b) => a.n - b.n);
    const raw = new Map(ordered.map((rev) => [rev.n, readFileSync(resolve('content/gist', rev.file), 'utf8')]));
    expect(ordered).toHaveLength(history.count);

    const results = new Map<number, { added: number; deleted: number; from: string; to: string }>();
    for (let index = 1; index < ordered.length; index++) {
      const prev = raw.get(ordered[index - 1]!.n)!;
      const curr = raw.get(ordered[index]!.n)!;
      const ops = diffLines(normalise(prev), normalise(curr));
      const counts = summary(ops);
      expect(counts.added + counts.deleted, `revision ${ordered[index]!.n} changes some text`).toBeGreaterThan(0);
      expect(hunks(ops).length, `revision ${ordered[index]!.n} has hunks`).toBeGreaterThan(0);
      results.set(ordered[index]!.n, { ...counts, from: lineEndings(prev), to: lineEndings(curr) });
    }

    // Facts about the snapshots (not the API counts): 13 flipped LF → CRLF and edited seven
    // sections, so the text-level diff is small where GitHub reports every line changed.
    const thirteen = results.get(13)!;
    expect(thirteen.from).toBe('LF');
    expect(thirteen.to).toBe('CRLF');
    expect(thirteen.added + thirteen.deleted).toBeLessThan(60);
    const thirteenApi = ordered.find((rev) => rev.n === 13)!;
    expect(thirteen.added + thirteen.deleted).toBeLessThan(thirteenApi.additions + thirteenApi.deletions);

    const ten = results.get(10)!;
    expect(ten.from).toBe('CRLF');
    expect(ten.to).toBe('LF');

    expect(results.get(3)!.deleted).toBeGreaterThan(500);
  });
});
