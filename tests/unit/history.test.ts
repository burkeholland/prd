import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  barScale,
  describeDelta,
  inclusiveDays,
  kb,
  lineEndings,
  rows,
  sectionDelta,
  sections,
  splitTimestamp,
  summary,
  type HistoryDocument,
  type HistoryRevision,
} from '../../src/lib/history';

const CRLF = (...lines: string[]) => lines.join('\r\n');
const LF = (...lines: string[]) => lines.join('\n');

const DRAFT = CRLF(
  '# Build The Urlist',
  '',
  'Preamble before the first heading.',
  '',
  '## Product ',
  'A link-sharing app.',
  '',
  '## Routes',
  '- `/`',
  '- `/new`',
  '',
  '## Notes',
  'Scratch.',
  '',
);

const NEXT = LF(
  '# Build The Urlist',
  '',
  'Preamble before the first heading.',
  '',
  '## Product',
  'A link-sharing app.',
  '',
  '## Routes',
  '- `/`',
  '- `/new`',
  '- `/lists`',
  '',
  '## Data model',
  'SQLite.',
  '',
);

const revision = (n: number, overrides: Partial<HistoryRevision> = {}): HistoryRevision => ({
  n,
  version: `version-${n}`,
  short: `${n}`.padStart(7, 'a'),
  committed_at: `2026-08-${String(11 + n).padStart(2, '0')}T20:39:59Z`,
  additions: 0,
  deletions: 0,
  total: 0,
  url: `https://gist.github.com/burkeholland/id/${n}`,
  file: `history/${String(n).padStart(2, '0')}-${`${n}`.padStart(7, 'a')}.md`,
  bytes: 1000 * n,
  lines: 10 * n,
  ...overrides,
});

const document = (revisions: HistoryRevision[]): HistoryDocument => ({
  id: 'id',
  owner: 'burkeholland',
  fetched_at: '2026-08-31T18:11:30.872Z',
  count: revisions.length,
  first_committed_at: revisions[0]?.committed_at ?? '',
  last_committed_at: revisions[revisions.length - 1]?.committed_at ?? '',
  additions_total: revisions.reduce((sum, rev) => sum + rev.additions, 0),
  deletions_total: revisions.reduce((sum, rev) => sum + rev.deletions, 0),
  revisions,
});

describe('sections', () => {
  it('splits a CRLF snapshot on h2 headings, keeping the h1 and preamble as section ""', () => {
    const parts = sections(DRAFT);
    expect(parts.map((section) => section.title)).toEqual(['', 'Product', 'Routes', 'Notes']);
    expect(parts[0]?.body).toBe('# Build The Urlist\n\nPreamble before the first heading.\n');
    expect(parts[1]?.body).toBe('A link-sharing app.\n');
    expect(parts[2]?.body).toBe('- `/`\n- `/new`\n');
  });

  it('ignores h1, h3 and deeper headings and omits an empty preamble', () => {
    const parts = sections(LF('## Only', '# not a split', '### nor this', 'text'));
    expect(parts).toEqual([{ title: 'Only', body: '# not a split\n### nor this\ntext' }]);
    expect(sections('')).toEqual([]);
  });
});

describe('sectionDelta', () => {
  it('reports added, removed, changed and unchanged sections by title', () => {
    const delta = sectionDelta(DRAFT, NEXT);
    expect(delta.added).toEqual(['Data model']);
    expect(delta.removed).toEqual(['Notes']);
    expect(delta.changed).toEqual(['Routes']);
    expect(delta.unchanged).toBe(2); // "" and Product (title whitespace and CRLF do not count)
    expect(delta.lineEndingsOnly).toBe(false);
  });

  it('treats a CRLF ↔ LF re-conversion as lineEndingsOnly with nothing changed', () => {
    const asLf = DRAFT.replace(/\r\n/g, '\n');
    const delta = sectionDelta(DRAFT, asLf);
    expect(delta).toEqual({
      added: [],
      removed: [],
      changed: [],
      unchanged: 4,
      lineEndingsOnly: true,
      eol: { from: 'CRLF', to: 'LF', changed: true },
    });
    expect(sectionDelta(DRAFT, DRAFT).lineEndingsOnly).toBe(false);
    expect(sectionDelta(DRAFT, DRAFT).eol).toEqual({ from: 'CRLF', to: 'CRLF', changed: false });
  });

  it('names a line-ending flip that comes with text edits', () => {
    const delta = sectionDelta(DRAFT, NEXT);
    expect(delta.lineEndingsOnly).toBe(false);
    expect(delta.eol).toEqual({ from: 'CRLF', to: 'LF', changed: true });
    expect(lineEndings('')).toBe('none');
    expect(lineEndings('a\r\nb\nc')).toBe('mixed');
  });

  it('marks everything as added for the first revision', () => {
    const delta = sectionDelta(null, DRAFT);
    expect(delta).toEqual({
      added: ['', 'Product', 'Routes', 'Notes'],
      removed: [],
      changed: [],
      unchanged: 0,
      lineEndingsOnly: false,
      eol: { from: null, to: 'CRLF', changed: false },
    });
  });

  it('flags a changed preamble under the "" title', () => {
    expect(sectionDelta(DRAFT, DRAFT.replace('Preamble', 'Intro')).changed).toEqual(['']);
  });
});

describe('rows', () => {
  const revisions = [
    revision(1, { version: 'v1' }),
    revision(2, { version: 'v2', committed_at: '2026-08-13T03:05:08Z' }),
    revision(3, { version: 'v3', additions: 14, deletions: 2, total: 16 }),
  ];
  const snapshots = {
    [revisions[0]!.file]: DRAFT,
    [revisions[1]!.file]: DRAFT.replace(/\r\n/g, '\n'),
    [revisions[2]!.file]: NEXT,
  };
  const list = rows(document(revisions), snapshots, 'v3');

  it('maps timestamps to a UTC date and time', () => {
    expect(list.map((row) => row.date)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14']);
    expect(list.map((row) => row.time)).toEqual(['20:39 UTC', '03:05 UTC', '20:39 UTC']);
    expect(splitTimestamp('2026-08-31T13:11:39+02:00')).toEqual({ date: '2026-08-31', time: '11:11 UTC' });
  });

  it('flags the current revision and the rows GitHub reports counts for', () => {
    expect(list.map((row) => row.isCurrent)).toEqual([false, false, true]);
    expect(list.map((row) => row.hasCounts)).toEqual([true, false, true]);
    expect(list.map((row) => row.sectionCount)).toEqual([3, 3, 3]);
    expect(list[1]?.delta.lineEndingsOnly).toBe(true);
    expect(list[2]?.delta).toMatchObject({ added: ['Data model'], removed: ['Notes'], changed: ['Routes'] });
    expect(list[0]).toMatchObject({ n: 1, short: 'aaaaaa1', url: revisions[0]!.url, bytes: 1000, lines: 10 });
  });

  it('throws when a snapshot is missing', () => {
    expect(() => rows(document(revisions), {}, 'v3')).toThrow(/history\/01-aaaaaa1\.md/);
  });

  it('describes each row for the "What changed" column', () => {
    expect(describeDelta(list[0]!)).toBe('First draft — 3 sections');
    expect(describeDelta(list[1]!)).toBe('Line endings only (CRLF ↔ LF); no text changed');
    expect(describeDelta(list[2]!)).toBe('Added: Data model; Changed: Routes; Removed: Notes');
    const eol = { from: 'LF' as const, to: 'CRLF' as const, changed: true };
    const flipped = { ...list[2]!, delta: { ...list[2]!.delta, eol } };
    expect(describeDelta(flipped)).toBe('Added: Data model; Changed: Routes; Removed: Notes; line endings LF → CRLF');
    const intro = {
      ...list[2]!,
      delta: { added: [], removed: [], changed: [''], unchanged: 3, lineEndingsOnly: false, eol: { ...eol, changed: false } },
    };
    expect(describeDelta(intro)).toBe('Changed: Intro');
    expect(describeDelta({ ...intro, delta: { ...intro.delta, changed: [] } })).toBe('No text changed');
  });
});

describe('summary', () => {
  it('counts calendar days inclusively and reports first/last size and sections', () => {
    const revisions = [
      revision(1, { committed_at: '2026-08-12T20:39:59Z', bytes: 21035 }),
      revision(2, { committed_at: '2026-08-31T13:11:39Z', bytes: 25389, additions: 1, deletions: 5 }),
    ];
    const snapshots = { [revisions[0]!.file]: DRAFT, [revisions[1]!.file]: NEXT };
    const doc = document(revisions);
    const result = summary(doc, rows(doc, snapshots, 'none'));
    expect(result).toEqual({
      count: 2,
      days: 20,
      firstDate: '2026-08-12',
      lastDate: '2026-08-31',
      additions_total: 1,
      deletions_total: 5,
      firstBytes: 21035,
      lastBytes: 25389,
      firstSections: 3,
      lastSections: 3,
    });
    expect(inclusiveDays('2026-08-12T23:59:59Z', '2026-08-13T00:00:01Z')).toBe(2);
    expect(inclusiveDays('2026-08-12T00:00:00Z', '2026-08-12T23:59:59Z')).toBe(1);
  });
});

describe('barScale', () => {
  it('scales the largest row to maxPx and the rest linearly', () => {
    const revisions = [revision(1, { bytes: 400 }), revision(2, { bytes: 800 }), revision(3, { bytes: 200 })];
    const snapshots = Object.fromEntries(revisions.map((rev) => [rev.file, DRAFT]));
    const list = rows(document(revisions), snapshots, 'none');
    expect(barScale(list)).toEqual([{ px: 80 }, { px: 160 }, { px: 40 }]);
    expect(barScale(list, 100)).toEqual([{ px: 50 }, { px: 100 }, { px: 25 }]);
  });

  it('guards against a zero maximum', () => {
    const revisions = [revision(1, { bytes: 0 })];
    const list = rows(document(revisions), { [revisions[0]!.file]: DRAFT }, 'none');
    expect(barScale(list)).toEqual([{ px: 0 }]);
    expect(barScale([])).toEqual([]);
  });
});

describe('kb', () => {
  it('formats bytes as decimal kilobytes', () => {
    expect(kb(25389)).toBe('25.4');
    expect(kb(21035, 0)).toBe('21');
  });
});

describe('the real gist history', () => {
  const HISTORY = resolve('content/gist/history.json');
  const META = resolve('content/gist/meta.json');
  const RAW = resolve('public/raw/build-the-urlist.md');
  const available = existsSync(HISTORY) && existsSync(META);

  it.skipIf(!available)('loads every snapshot and derives one row per revision', () => {
    const history = JSON.parse(readFileSync(HISTORY, 'utf8')) as HistoryDocument;
    const meta = JSON.parse(readFileSync(META, 'utf8')) as { revision: string };
    const snapshots = Object.fromEntries(
      history.revisions.map((rev) => [rev.file, readFileSync(resolve('content/gist', rev.file), 'utf8')]),
    );

    const list = rows(history, snapshots, meta.revision);
    expect(list).toHaveLength(history.count);
    expect(list.map((row) => row.n)).toEqual(history.revisions.map((rev) => rev.n));

    const current = list.filter((row) => row.isCurrent);
    expect(current).toHaveLength(1);
    expect(list.filter((row) => !row.hasCounts).map((row) => row.n)).toEqual([2, 3, 4, 5, 6]);

    // The task brief expected revision 13 to be a pure line-ending re-conversion. The snapshots
    // say otherwise: it flipped LF → CRLF *and* edited seven sections (24 916 − 24 349 bytes ≠ 268
    // line endings), so `lineEndingsOnly` is false and the flip is reported alongside the edits.
    const thirteen = list.find((row) => row.n === 13)!;
    expect(thirteen.delta.eol).toEqual({ from: 'LF', to: 'CRLF', changed: true });
    expect(thirteen.delta.lineEndingsOnly).toBe(false);
    expect(thirteen.delta.changed.length).toBeGreaterThan(0);
    expect(describeDelta(thirteen)).toMatch(/^Changed: .*; line endings LF → CRLF$/);
    const ten = list.find((row) => row.n === 10)!;
    expect(ten.delta.eol).toEqual({ from: 'CRLF', to: 'LF', changed: true });
    expect(list.filter((row) => row.delta.eol.changed).map((row) => row.n)).toEqual([10, 13]);

    for (const row of list.slice(1)) {
      if (row.delta.lineEndingsOnly) continue;
      const touched = row.delta.added.length + row.delta.removed.length + row.delta.changed.length;
      expect(touched, `revision ${row.n} should report a change`).toBeGreaterThan(0);
    }

    const result = summary(history, list);
    expect(result.days).toBe(inclusiveDays(history.first_committed_at, history.last_committed_at));
    expect(result.firstSections).toBeGreaterThan(0);
    expect(result.lastSections).toBeGreaterThan(0);

    if (existsSync(RAW)) {
      const file = history.revisions.find((rev) => rev.version === meta.revision)!.file;
      const snapshot = readFileSync(resolve('content/gist', file));
      expect(snapshot.equals(readFileSync(RAW)), 'current snapshot equals the download byte for byte').toBe(true);
    }
  });
});
