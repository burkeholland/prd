import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hasNote, missingRevisions } from '../../scripts/history-notes-missing.mjs';

// `npm run notes:missing` is what a note-writer runs when the daily refresh opens a PR whose
// history-notes.test.ts is red: it must name exactly the revisions without a note and show their diff.
type Revision = { n: number; version: string; short: string; file: string };
type History = { count: number; revisions: Revision[] };
type Notes = { notes: Record<string, string> };

const SCRIPT = resolve('scripts/history-notes-missing.mjs');
const history = JSON.parse(readFileSync(resolve('content/gist/history.json'), 'utf8')) as History;
const notes = JSON.parse(readFileSync(resolve('content/gist/history-notes.json'), 'utf8')) as Notes;

const NEW_SHA = '0123abcd0123abcd0123abcd0123abcd0123abcd';

function run(args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: resolve('.'), encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const tempDirs: string[] = [];
function tempFile(name: string, contents: unknown) {
  const dir = mkdtempSync(join(tmpdir(), 'history-notes-missing-'));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, JSON.stringify(contents, null, 2));
  return file;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('missingRevisions', () => {
  it('finds nothing missing with the real history.json and history-notes.json', () => {
    expect(history.revisions.length).toBe(history.count);
    expect(missingRevisions(history, notes)).toEqual([]);
  });

  it('reports exactly the one un-annotated revision, with its n and its previous sha', () => {
    const last = history.revisions.at(-1)!;
    const extra: Revision = { n: last.n + 1, version: NEW_SHA, short: NEW_SHA.slice(0, 7), file: `history/${last.n + 1}-${NEW_SHA.slice(0, 7)}.md` };
    const synthetic: History = { count: history.count + 1, revisions: [...history.revisions, extra] };

    const missing = missingRevisions(synthetic, notes);
    expect(missing.map((rev) => rev.n)).toEqual([last.n + 1]);
    expect(missing[0].version).toBe(NEW_SHA);
    expect(missing[0].previous?.n).toBe(last.n);
    expect(missing[0].previous?.version).toBe(last.version);
  });

  it('keeps history order and gives the first revision no previous', () => {
    const [first, second, ...rest] = history.revisions;
    const withoutTwo: Notes = { notes: { ...notes.notes } };
    delete withoutTwo.notes[first.version];
    delete withoutTwo.notes[second.version];

    const missing = missingRevisions({ count: history.count, revisions: [first, second, ...rest] }, withoutTwo);
    expect(missing.map((rev) => rev.n)).toEqual([first.n, second.n]);
    expect(missing[0].previous).toBeNull();
    expect(missing[1].previous?.version).toBe(first.version);
  });

  it('ignores prototype keys: "__proto__", "constructor" and "toString" are never notes', () => {
    const protoNotes = JSON.parse('{"notes":{"__proto__":"A sentence that is long enough to pass the house style, but keyed wrong.","constructor":"Also not a real note key, no matter how long this sentence is made to be."}}') as Notes;
    const revisions = [
      { n: 1, version: '__proto__', short: '__proto', file: 'history/01-__proto.md' },
      { n: 2, version: 'constructor', short: 'constru', file: 'history/02-constru.md' },
      { n: 3, version: 'toString', short: 'toStrin', file: 'history/03-toStrin.md' },
      { n: 4, version: NEW_SHA, short: NEW_SHA.slice(0, 7), file: 'history/04-0123abc.md' },
    ];
    expect(missingRevisions({ count: 4, revisions }, protoNotes).map((rev) => rev.n)).toEqual([1, 2, 3, 4]);
    expect(hasNote(protoNotes, '__proto__')).toBe(false);
    expect(hasNote(protoNotes, 'constructor')).toBe(false);
    expect(hasNote(protoNotes, 'toString')).toBe(false);
    expect(hasNote(notes, '')).toBe(false);
    expect(hasNote(notes, history.revisions[0].version)).toBe(true);
  });

  it('does not count an empty or non-string note', () => {
    const last = history.revisions.at(-1)!;
    const blank: Notes = { notes: { ...notes.notes, [last.version]: '   ' } };
    expect(missingRevisions(history, blank).map((rev) => rev.n)).toEqual([last.n]);
    const wrongType = { notes: { ...notes.notes, [last.version]: 42 as unknown as string } };
    expect(missingRevisions(history, wrongType).map((rev) => rev.n)).toEqual([last.n]);
  });
});

describe('scripts/history-notes-missing.mjs (npm run notes:missing)', () => {
  it('exits 0 and says every revision has a note with the files on disk', () => {
    const { status, stdout, stderr } = run([]);
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(`All ${history.count} revisions have a note.`);
  });

  it('exits 1 and prints one block with the diff when the last note is missing (--notes <copy>)', () => {
    const last = history.revisions.at(-1)!;
    const prev = history.revisions.at(-2)!;
    const copy: Notes = { notes: { ...notes.notes } };
    delete copy.notes[last.version];

    const { status, stdout } = run(['--notes', tempFile('history-notes.json', copy)]);
    expect(status).toBe(1);
    const lines = stdout.split(/\r?\n/);
    expect(lines[0]).toMatch(new RegExp(`^Revision ${last.n} of ${history.count} — .+ — \\+\\d+ −\\d+ — sha ${last.short}…$`));
    expect(lines[1]).toBe(last.version);
    expect(lines[2]).toBe(`Previous revision: ${prev.n} (sha ${prev.version})`);
    expect(lines[3]).toBe(`--- diff of build-the-urlist.md, revision ${prev.n} → ${last.n} ---`);
    expect(lines[4]).toBe(`--- a/content/gist/${prev.file}`);
    expect(lines[5]).toBe(`+++ b/content/gist/${last.file}`);
    expect(lines.some((line) => line.startsWith('diff --git ') || line.startsWith('index ')), 'git header lines are stripped').toBe(false);
    expect(lines.some((line) => /^[+-][^+-]/.test(line)), 'at least one changed line').toBe(true);
    expect(stdout.match(/^Revision \d+ of \d+/gm), 'exactly one block').toHaveLength(1);
  });

  it('says "First revision — no diff." for a revision without a predecessor', () => {
    const first = history.revisions[0];
    const copy: Notes = { notes: { ...notes.notes } };
    delete copy.notes[first.version];

    const { status, stdout } = run(['--notes', tempFile('history-notes.json', copy)]);
    expect(status).toBe(1);
    const lines = stdout.split(/\r?\n/);
    expect(lines[0]).toMatch(new RegExp(`^Revision 1 of ${history.count} — `));
    expect(lines[1]).toBe(first.version);
    expect(lines[2]).toBe('First revision — no diff.');
  });

  it('exits 2 on an unreadable notes file', () => {
    const { status, stderr } = run(['--notes', join(tmpdir(), 'history-notes-missing-does-not-exist.json')]);
    expect(status).toBe(2);
    expect(stderr).toMatch(/cannot read history-notes\.json/);
  });
});
