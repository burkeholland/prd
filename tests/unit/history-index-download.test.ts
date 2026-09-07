import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import historyJson from '../../content/gist/history.json';
import metaJson from '../../content/gist/meta.json';
import {
  createHistoryIndexResponse,
  HISTORY_INDEX_DOWNLOAD,
  HISTORY_INDEX_REVISION_COUNT,
  serializeHistoryIndex,
  type HistoryIndexSource,
} from '../../src/lib/history-index-download';
import { historyDownloadPath } from '../../src/lib/history-downloads';
import { NOTES } from '../../src/lib/history-notes';
import {
  createPrdRevisionHistoryResponse,
  GET,
  historyIndexSource,
  prerender,
} from '../../src/pages/downloads/prd-revision-history.md';

const historyDirectory = resolve('content/gist/history');
const snapshots = Object.fromEntries(
  readdirSync(historyDirectory)
    .filter((file) => file.endsWith('.md'))
    .map((file) => [
      `history/${file}`,
      readFileSync(resolve(historyDirectory, file)),
    ]),
);
const source: HistoryIndexSource = {
  history: historyJson,
  snapshots,
  current: metaJson,
  notes: NOTES,
};

const cloneSource = (): HistoryIndexSource => ({
  history: structuredClone(source.history),
  snapshots: { ...source.snapshots },
  current: structuredClone(source.current),
  notes: structuredClone(source.notes),
});

const replaceRevision = (
  input: HistoryIndexSource,
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
}) as unknown as HistoryIndexSource;

describe('revision history Markdown serializer', () => {
  it('serializes all checked-in history values in chronological order', () => {
    const first = serializeHistoryIndex(source);
    const second = serializeHistoryIndex(source);

    expect(first).toBe(second);
    expect(first).toMatch(/^# Example PRD revision history\n/);
    expect(first.match(/^# /gm)).toHaveLength(1);
    expect(first.match(/^## Revision \d+$/gm)).toEqual(
      Array.from(
        { length: HISTORY_INDEX_REVISION_COUNT },
        (_, index) => `## Revision ${index + 1}`,
      ),
    );
    expect(first).toContain(
      `This index contains exactly ${historyJson.count} revisions from ` +
        `${historyJson.first_committed_at.slice(0, 10)} through ` +
        `${historyJson.last_committed_at.slice(0, 10)} (UTC).`,
    );
    expect(first.match(/^Current example revision$/gm)).toHaveLength(1);

    for (const revision of historyJson.revisions) {
      const note = NOTES[revision.version];
      expect(note).toBeDefined();
      expect(
        first.match(new RegExp(`^## Revision ${revision.n}$`, 'gm')),
      ).toHaveLength(1);
      expect(first).toContain(`- UTC date: ${revision.committed_at}`);
      expect(first).toContain(`- Note: ${note}`);
      expect(first).toContain(`- Bytes: ${revision.bytes}`);
      expect(first).toContain(`- Lines: ${revision.lines}`);
      expect(first).toContain(`- Additions: ${revision.additions}`);
      expect(first).toContain(`- Deletions: ${revision.deletions}`);
      expect(first).toContain(
        `- Revision page: https://burkeholland.github.io/prd/history/${revision.n}/`,
      );
      expect(first).toContain(`- GitHub revision: ${revision.url}`);
      expect(first).toContain(
        `- Markdown snapshot: https://burkeholland.github.io/prd${historyDownloadPath(revision)}`,
      );
    }

    const currentNumber = historyJson.revisions.find(
      (revision) => revision.version === metaJson.revision,
    )!.n;
    expect(first).toContain(
      `## Revision ${currentNumber}\nCurrent example revision\n`,
    );
    const urls = first.match(/https:\/\/\S+/g) ?? [];
    expect(urls).toHaveLength(HISTORY_INDEX_REVISION_COUNT * 3);
    for (const href of urls) {
      const url = new URL(href);
      expect(url.search).toBe('');
      expect(url.hash).toBe('');
      expect(url.hostname).not.toBe('localhost');
    }
    expect(first).not.toContain('\r');
    expect(first).toMatch(/[^\n]\n$/);
    expect(first).not.toMatch(/\n\n$/);
  });

  it('rejects each malformed or incomplete source instead of emitting an index', () => {
    const swapped = cloneSource();
    [swapped.history.revisions[0], swapped.history.revisions[1]] = [
      swapped.history.revisions[1]!,
      swapped.history.revisions[0]!,
    ];
    const missingSnapshot = cloneSource();
    delete missingSnapshot.snapshots[missingSnapshot.history.revisions[0]!.file];
    const missingNote = cloneSource();
    const missingNoteVersion = missingNote.history.revisions[0]!.version;
    delete (missingNote.notes as Record<string, string>)[missingNoteVersion];
    const second = source.history.revisions[1]!;
    const multipleCurrent = replaceRevision(cloneSource(), 1, {
      version: metaJson.revision,
      url: `${SITE_GIST_URL}/${metaJson.revision}`,
    });

    const cases: {
      name: string;
      input: HistoryIndexSource;
      message: RegExp;
    }[] = [
      {
        name: 'missing history data',
        input: { ...cloneSource(), history: null } as unknown as HistoryIndexSource,
        message: /history data is missing or malformed/i,
      },
      {
        name: 'non-16 count',
        input: {
          ...cloneSource(),
          history: { ...source.history, count: 15 },
        },
        message: /expected exactly 16 revisions, found 15/i,
      },
      {
        name: 'missing revision number',
        input: replaceRevision(cloneSource(), 2, { n: 17 }),
        message: /missing revision numbers 3/i,
      },
      {
        name: 'duplicate revision number',
        input: replaceRevision(cloneSource(), 1, { n: 1 }),
        message: /duplicate revision numbers/i,
      },
      {
        name: 'out-of-order revision numbers',
        input: swapped,
        message: /revision numbers are out of order/i,
      },
      {
        name: 'missing snapshot coverage',
        input: missingSnapshot,
        message: /snapshot coverage mismatch.*missing:/i,
      },
      {
        name: 'missing note',
        input: missingNote,
        message: /revision 1 note is missing or blank/i,
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
        name: 'multiple current revisions',
        input: multipleCurrent,
        message: /expected exactly one current revision, found 2/i,
      },
      {
        name: 'invalid external URL',
        input: replaceRevision(cloneSource(), 1, {
          url: second.url.replace('https:', 'http:'),
        }),
        message: /revision 2 has an invalid external URL/i,
      },
      {
        name: 'blank metric',
        input: replaceRevision(cloneSource(), 0, { bytes: '' }),
        message: /revision 1 bytes is blank/i,
      },
      {
        name: 'unsafe scalar line break',
        input: replaceRevision(cloneSource(), 0, {
          committed_at: `${source.history.revisions[0]!.committed_at}\nunsafe`,
        }),
        message: /revision 1 timestamp contains an unsafe line break/i,
      },
      {
        name: 'malformed timestamp',
        input: replaceRevision(cloneSource(), 0, {
          committed_at: '2026-13-40T99:99:99Z',
        }),
        message: /revision 1 timestamp is not a valid UTC timestamp/i,
      },
    ];

    for (const fixture of cases) {
      expect(
        () => serializeHistoryIndex(fixture.input),
        fixture.name,
      ).toThrow(fixture.message);
    }
  });
});

const SITE_GIST_URL =
  'https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817';

describe('prerendered revision history response', () => {
  it('returns deterministic UTF-8 attachment bytes from the real source twice', async () => {
    expect(prerender).toBe(true);
    expect(GET).toBe(createPrdRevisionHistoryResponse);
    expect(historyIndexSource.history).toEqual(historyJson);
    expect(
      Object.keys(historyIndexSource.snapshots)
        .map((file) => basename(file))
        .sort(),
    ).toEqual(
      Object.keys(snapshots)
        .map((file) => basename(file))
        .sort(),
    );

    const responses = [
      createPrdRevisionHistoryResponse(),
      createPrdRevisionHistoryResponse(),
      createHistoryIndexResponse(source),
    ];
    const bytes = await Promise.all(
      responses.map(async (response) =>
        new Uint8Array(await response.arrayBuffer()),
      ),
    );
    const expected = new TextEncoder().encode(serializeHistoryIndex(source));

    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        HISTORY_INDEX_DOWNLOAD.mime,
      );
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${HISTORY_INDEX_DOWNLOAD.filename}"`,
      );
      expect(bytes[index]).toEqual(expected);
      expect(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes[index]),
      ).toBe(serializeHistoryIndex(source));
    }
    expect(bytes[0]).toEqual(bytes[1]);
    expect(bytes[0].byteLength).toBeGreaterThan(0);
  });
});
