import { describe, expect, it } from 'vitest';
import historyJson from '../../content/gist/history.json';
import metaJson from '../../content/gist/meta.json';
import {
  createHistoryCsvResponse,
  escapeCsvCell,
  HISTORY_CSV_DOWNLOAD,
  HISTORY_CSV_REVISION_COUNT,
  serializeHistoryCsv,
  type HistoryCsvSource,
} from '../../src/lib/history-csv-download';
import {
  historyRevisionGithubUrl,
  historyRevisionMarkdownUrl,
  historyRevisionPublicUrl,
} from '../../src/lib/history-downloads';
import {
  createPrdRevisionHistoryCsvResponse,
  GET,
  historyCsvSource,
  prerender,
} from '../../src/pages/downloads/prd-revision-history.csv';

const HEADER =
  'revision,current,committed_at,bytes,lines,additions,deletions,total,public_url,github_url,markdown_url';
const source: HistoryCsvSource = {
  history: historyJson,
  current: metaJson,
};

const cloneSource = (): HistoryCsvSource => structuredClone(source);

const replaceRevision = (
  input: HistoryCsvSource,
  index: number,
  replacement: Record<string, unknown>,
) => ({
  ...input,
  history: {
    ...input.history,
    revisions: input.history.revisions.map((revision, revisionIndex) =>
      revisionIndex === index ? { ...revision, ...replacement } : revision,
    ),
  },
}) as unknown as HistoryCsvSource;

describe('revision history CSV serializer', () => {
  it('serializes all real metadata into 16 chronological, 11-column rows', () => {
    const first = serializeHistoryCsv(source);
    const second = serializeHistoryCsv(source);
    const records = first.split('\r\n');

    expect(first).toBe(second);
    expect(records.at(-1)).toBe('');
    expect(records.slice(0, -1)).toHaveLength(HISTORY_CSV_REVISION_COUNT + 1);
    expect(records[0]).toBe(HEADER);
    expect(first.match(/\r\n/g)).toHaveLength(HISTORY_CSV_REVISION_COUNT + 1);
    expect(first.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(first).toMatch(/[^\r\n]\r\n$/);
    expect(first).not.toMatch(/\r\n\r\n$/);

    const rows = records.slice(1, -1).map((record) => record.split(','));
    expect(rows.every((row) => row.length === 11)).toBe(true);
    expect(rows.map((row) => row[0])).toEqual(
      historyJson.revisions.map((revision) => String(revision.n)),
    );
    expect(rows.filter((row) => row[1] === 'true')).toHaveLength(1);
    expect(rows.filter((row) => row[1] === 'false')).toHaveLength(15);

    for (const [index, revision] of historyJson.revisions.entries()) {
      expect(rows[index]).toEqual([
        String(revision.n),
        String(revision.version === metaJson.revision),
        revision.committed_at,
        String(revision.bytes),
        String(revision.lines),
        String(revision.additions),
        String(revision.deletions),
        String(revision.total),
        historyRevisionPublicUrl(revision),
        historyRevisionGithubUrl(revision),
        historyRevisionMarkdownUrl(revision),
      ]);
    }

    const numericCells = rows.flatMap((row) => [
      row[0],
      row[3],
      row[4],
      row[5],
      row[6],
      row[7],
    ]);
    expect(numericCells).toHaveLength(96);
    expect(numericCells.every((cell) => /^\d+$/.test(cell ?? ''))).toBe(true);

    const urls = rows.flatMap((row) => row.slice(8));
    expect(urls).toHaveLength(48);
    for (const href of urls) {
      const url = new URL(href);
      expect(url.protocol).toBe('https:');
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
      expect(url.href).toBe(href);
    }
  });

  it('quotes commas, quotes, and normalized CRLF line breaks per RFC 4180', () => {
    expect(escapeCsvCell('plain')).toBe('plain');
    expect(escapeCsvCell('comma,value')).toBe('"comma,value"');
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');
    expect(escapeCsvCell('first\nsecond')).toBe('"first\r\nsecond"');
    expect(escapeCsvCell('first\rsecond')).toBe('"first\r\nsecond"');
    expect(escapeCsvCell('first\r\nsecond')).toBe('"first\r\nsecond"');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(false)).toBe('false');
  });

  it('rejects malformed counts, ordering, current metadata, metrics, dates, and URLs', () => {
    const swapped = cloneSource();
    [swapped.history.revisions[0], swapped.history.revisions[1]] = [
      swapped.history.revisions[1]!,
      swapped.history.revisions[0]!,
    ];
    const second = source.history.revisions[1]!;
    const multipleCurrent = replaceRevision(cloneSource(), 1, {
      version: metaJson.revision,
      short: metaJson.revision.slice(0, 7),
      url: `https://gist.github.com/${historyJson.owner}/${historyJson.id}/${metaJson.revision}`,
    });
    const cases: {
      name: string;
      input: HistoryCsvSource;
      message: RegExp;
    }[] = [
      {
        name: 'missing history',
        input: { ...cloneSource(), history: null } as unknown as HistoryCsvSource,
        message: /history data is missing or malformed/i,
      },
      {
        name: 'wrong count',
        input: {
          ...cloneSource(),
          history: { ...source.history, count: 15 },
        },
        message: /expected exactly 16 revisions, found 15/i,
      },
      {
        name: 'missing record',
        input: {
          ...cloneSource(),
          history: {
            ...source.history,
            revisions: source.history.revisions.slice(0, -1),
          },
        },
        message: /expected exactly 16 revision records, found 15/i,
      },
      {
        name: 'out of order',
        input: swapped,
        message: /revision numbers are out of order/i,
      },
      {
        name: 'no current revision',
        input: {
          ...cloneSource(),
          current: { revision: 'f'.repeat(40) },
        },
        message: /expected exactly one current revision, found 0/i,
      },
      {
        name: 'invalid current SHA',
        input: {
          ...cloneSource(),
          current: { revision: 'not-a-sha' },
        },
        message: /current revision has an invalid version SHA/i,
      },
      {
        name: 'multiple current revisions',
        input: multipleCurrent,
        message: /expected exactly one current revision, found 2/i,
      },
      {
        name: 'blank metric',
        input: replaceRevision(cloneSource(), 0, { bytes: '' }),
        message: /revision 1 bytes is blank/i,
      },
      {
        name: 'negative metric',
        input: replaceRevision(cloneSource(), 0, { lines: -1 }),
        message: /revision 1 lines must be a non-negative integer/i,
      },
      {
        name: 'inconsistent change total',
        input: replaceRevision(cloneSource(), 1, {
          total: second.total + 1,
        }),
        message: /revision 2 change metrics do not add up/i,
      },
      {
        name: 'inconsistent aggregate',
        input: {
          ...cloneSource(),
          history: { ...source.history, additions_total: 0 },
        },
        message: /aggregate change metrics do not match/i,
      },
      {
        name: 'malformed timestamp',
        input: replaceRevision(cloneSource(), 0, {
          committed_at: '2026-13-40T99:99:99Z',
        }),
        message: /revision 1 timestamp is not a valid UTC timestamp/i,
      },
      {
        name: 'chronology',
        input: replaceRevision(cloneSource(), 1, {
          committed_at: '2026-08-01T00:00:00Z',
        }),
        message: /revision timestamps are out of chronological order/i,
      },
      {
        name: 'insecure GitHub URL',
        input: replaceRevision(cloneSource(), 1, {
          url: second.url.replace('https:', 'http:'),
        }),
        message: /revision 2 has an invalid external URL/i,
      },
      {
        name: 'GitHub URL query',
        input: replaceRevision(cloneSource(), 1, {
          url: `${second.url}?download=1`,
        }),
        message: /revision 2 has an invalid external URL/i,
      },
    ];

    for (const fixture of cases) {
      expect(
        () => serializeHistoryCsv(fixture.input),
        fixture.name,
      ).toThrow(fixture.message);
    }
  });
});

describe('prerendered revision history CSV response', () => {
  it('uses only checked-in history/current metadata and returns deterministic UTF-8 bytes', async () => {
    expect(prerender).toBe(true);
    expect(GET).toBe(createPrdRevisionHistoryCsvResponse);
    expect(Object.keys(historyCsvSource).sort()).toEqual(['current', 'history']);
    expect(historyCsvSource).toEqual(source);

    const responses = [
      createPrdRevisionHistoryCsvResponse(),
      createPrdRevisionHistoryCsvResponse(),
      createHistoryCsvResponse(source),
    ];
    const bytes = await Promise.all(
      responses.map(async (response) =>
        new Uint8Array(await response.arrayBuffer()),
      ),
    );
    const expected = new TextEncoder().encode(serializeHistoryCsv(source));

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        HISTORY_CSV_DOWNLOAD.mime,
      );
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${HISTORY_CSV_DOWNLOAD.filename}"`,
      );
      expect(bytes[index]).toEqual(expected);
      expect(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes[index]),
      ).toBe(serializeHistoryCsv(source));
    }
    expect(bytes[0]).toEqual(bytes[1]);
  });
});
