import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTES, noteFor } from '../../src/lib/history-notes';

// The notes are keyed by `version` (the gist commit sha) so they survive the daily refresh of
// history.json; these tests keep the two files in step and hold every note to the house rules.
const history = JSON.parse(readFileSync(resolve('content/gist/history.json'), 'utf8')) as {
  count: number;
  revisions: { n: number; version: string }[];
};

describe('history notes', () => {
  it('has one note for every revision in history.json', () => {
    expect(history.revisions.length).toBe(history.count);
    const missing = history.revisions.filter((rev) => noteFor(rev.version) === undefined).map((rev) => rev.n);
    expect(missing, 'revisions without a note').toEqual([]);
  });

  it('has no orphaned key: every note belongs to a revision', () => {
    const versions = new Set(history.revisions.map((rev) => rev.version));
    const orphans = Object.keys(NOTES).filter((sha) => !versions.has(sha));
    expect(orphans, 'note keys that match no revision').toEqual([]);
  });

  it('every note is one sentence of 60–160 characters that ends with a period', () => {
    for (const rev of history.revisions) {
      const note = noteFor(rev.version) ?? '';
      expect(note.length, `revision ${rev.n} length`).toBeGreaterThanOrEqual(60);
      expect(note.length, `revision ${rev.n} length`).toBeLessThanOrEqual(160);
      expect(note.endsWith('.'), `revision ${rev.n} ends with a period`).toBe(true);
      expect(note, `revision ${rev.n} has a line break`).not.toMatch(/\n/);
    }
  });

  it('every note follows the house style: no "the model", no line counts', () => {
    for (const rev of history.revisions) {
      const note = noteFor(rev.version) ?? '';
      expect(note, `revision ${rev.n} says "the model"`).not.toMatch(/\bthe model\b/i);
      expect(note, `revision ${rev.n} quotes a line count`).not.toMatch(/\d+ lines/);
    }
  });

  it('noteFor returns undefined for an unknown sha and ignores prototype keys', () => {
    expect(noteFor('nope')).toBeUndefined();
    expect(noteFor('')).toBeUndefined();
    expect(noteFor('toString')).toBeUndefined();
  });
});
