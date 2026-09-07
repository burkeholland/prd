import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/lib/content.mjs';
import {
  createDeterministicZipResponse,
  type DeterministicZipFile,
} from '../../src/lib/deterministic-zip';
import {
  createExampleCaseStudyResponse,
  EXAMPLE_CASE_STUDY_FILENAME,
  EXAMPLE_CASE_STUDY_FILES,
  EXAMPLE_CASE_STUDY_MIME,
  EXAMPLE_CASE_STUDY_UNIX_MODE,
  EXAMPLE_CASE_STUDY_ZIP_DATE,
  EXAMPLE_CASE_STUDY_ZIP_TIME,
  type ExampleCaseStudySources,
} from '../../src/lib/example-case-study';
import {
  createCurrentExampleMarkdownResponse,
  CURRENT_EXAMPLE_MARKDOWN_FILENAME,
} from '../../src/lib/example-markdown-download';
import { HISTORY_INDEX_DOWNLOAD } from '../../src/lib/history-index-download';
import {
  createWalkthroughMarkdownResponse,
  WALKTHROUGH_DOWNLOAD_FILENAME,
  type WalkthroughDownloadEntry,
} from '../../src/lib/walkthrough-download';
import { createPrdRevisionHistoryResponse } from '../../src/pages/downloads/prd-revision-history.md';

const parsedWalkthrough = parseFrontmatter(
  readFileSync(resolve('content/walkthrough.md'), 'utf8'),
);
if (
  !parsedWalkthrough.data ||
  !('title' in parsedWalkthrough.data) ||
  !('description' in parsedWalkthrough.data) ||
  typeof parsedWalkthrough.data.title !== 'string' ||
  typeof parsedWalkthrough.data.description !== 'string'
) {
  throw new Error('content/walkthrough.md requires title and description');
}
const walkthrough = {
  data: {
    title: parsedWalkthrough.data.title,
    description: parsedWalkthrough.data.description,
  },
  body: parsedWalkthrough.body,
} satisfies WalkthroughDownloadEntry;

const sources = (): ExampleCaseStudySources => ({
  [CURRENT_EXAMPLE_MARKDOWN_FILENAME]:
    createCurrentExampleMarkdownResponse,
  [WALKTHROUGH_DOWNLOAD_FILENAME]: () =>
    createWalkthroughMarkdownResponse(walkthrough),
  [HISTORY_INDEX_DOWNLOAD.filename]: createPrdRevisionHistoryResponse,
});

const responseBytes = async (response: Response) =>
  new Uint8Array(await response.arrayBuffer());

interface CentralEntry {
  readonly filename: string;
  readonly versionMadeBy: number;
  readonly flags: number;
  readonly compression: number;
  readonly time: number;
  readonly date: number;
  readonly crc32: number;
  readonly externalAttributes: number;
  readonly localOffset: number;
}

const centralEntries = (bytes: Uint8Array): CentralEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.byteLength - 22;
  expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
  expect(view.getUint16(endOffset + 8, true)).toBe(
    EXAMPLE_CASE_STUDY_FILES.length,
  );
  expect(view.getUint16(endOffset + 10, true)).toBe(
    EXAMPLE_CASE_STUDY_FILES.length,
  );
  expect(view.getUint16(endOffset + 20, true)).toBe(0);

  let offset = view.getUint32(endOffset + 16, true);
  const entries: CentralEntry[] = [];
  while (offset < endOffset) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      filename: new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.slice(offset + 46, offset + 46 + nameLength),
      ),
      versionMadeBy: view.getUint16(offset + 4, true),
      flags: view.getUint16(offset + 8, true),
      compression: view.getUint16(offset + 10, true),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      crc32: view.getUint32(offset + 16, true),
      externalAttributes: view.getUint32(offset + 38, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  expect(offset).toBe(endOffset);
  return entries;
};

describe('Example case-study archive', () => {
  it('returns deterministic valid bytes with exactly three ordered source files and fixed metadata', async () => {
    const first = await createExampleCaseStudyResponse(sources());
    const second = await createExampleCaseStudyResponse(sources());
    const bytes = await responseBytes(first);
    const repeated = await responseBytes(second);

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(EXAMPLE_CASE_STUDY_MIME);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${EXAMPLE_CASE_STUDY_FILENAME}"`,
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.slice(0, 4)).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(repeated).toEqual(bytes);

    const expectedNames = EXAMPLE_CASE_STUDY_FILES.map(
      ({ filename }) => filename,
    );
    const metadata = centralEntries(bytes);
    expect(metadata.map(({ filename }) => filename)).toEqual(expectedNames);
    for (const entry of metadata) {
      expect(entry.filename).not.toMatch(/[\\/]/);
      expect(entry.versionMadeBy).toBe(0x0314);
      expect(entry.flags).toBe(0x0800);
      expect(entry.compression).toBe(0);
      expect(entry.time).toBe(EXAMPLE_CASE_STUDY_ZIP_TIME);
      expect(entry.date).toBe(EXAMPLE_CASE_STUDY_ZIP_DATE);
      expect(entry.crc32).not.toBe(0);
      expect(entry.externalAttributes).toBe(
        EXAMPLE_CASE_STUDY_UNIX_MODE * 0x10000,
      );

      const local = new DataView(
        bytes.buffer,
        bytes.byteOffset + entry.localOffset,
      );
      expect(local.getUint32(0, true)).toBe(0x04034b50);
      expect(local.getUint16(6, true)).toBe(0x0800);
      expect(local.getUint16(8, true)).toBe(0);
      expect(local.getUint16(10, true)).toBe(EXAMPLE_CASE_STUDY_ZIP_TIME);
      expect(local.getUint16(12, true)).toBe(EXAMPLE_CASE_STUDY_ZIP_DATE);
      expect(local.getUint32(14, true)).toBe(entry.crc32);
      expect(local.getUint16(28, true)).toBe(0);
    }

    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(expectedNames);
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);
    const standalone = sources();
    for (const { filename } of EXAMPLE_CASE_STUDY_FILES) {
      expect(await zip.file(filename)?.async('uint8array'), filename).toEqual(
        await responseBytes(await standalone[filename]()),
      );
    }
    expect(await zip.file(CURRENT_EXAMPLE_MARKDOWN_FILENAME)?.async('nodebuffer'))
      .toEqual(readFileSync(resolve('public/raw/build-the-urlist.md')));
  });

  it('rejects every invalid source without returning a partial archive', async () => {
    const firstFilename = CURRENT_EXAMPLE_MARKDOWN_FILENAME;
    const sourceHeaders = {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${firstFilename}"`,
    };
    const fixtures: {
      name: string;
      factory: () => Response | Promise<Response>;
      message: string;
    }[] = [
      {
        name: 'non-Response helper',
        factory: () => undefined as unknown as Response,
        message: 'must return a Response',
      },
      {
        name: 'non-200 response',
        factory: () =>
          new Response('failed', { status: 503, headers: sourceHeaders }),
        message: 'returned status 503; expected 200',
      },
      {
        name: 'wrong MIME',
        factory: () =>
          new Response('content', {
            headers: { ...sourceHeaders, 'Content-Type': 'text/plain' },
          }),
        message: 'returned MIME "text/plain"',
      },
      {
        name: 'wrong filename',
        factory: () =>
          new Response('content', {
            headers: {
              ...sourceHeaders,
              'Content-Disposition': 'attachment; filename="other.md"',
            },
          }),
        message: 'returned filename "other.md"',
      },
      {
        name: 'empty bytes',
        factory: () => new Response(new Uint8Array(), { headers: sourceHeaders }),
        message: 'returned empty bytes',
      },
    ];

    const { [firstFilename]: _missing, ...missing } = sources();
    await expect(createExampleCaseStudyResponse(missing)).rejects.toThrow(
      `source helper for "${firstFilename}" is required`,
    );
    for (const fixture of fixtures) {
      await expect(
        createExampleCaseStudyResponse({
          ...sources(),
          [firstFilename]: fixture.factory,
        }),
        fixture.name,
      ).rejects.toThrow(fixture.message);
    }

    const sourceError = new Error('current Example source unavailable');
    await expect(
      createExampleCaseStudyResponse({
        ...sources(),
        [firstFilename]: () => {
          throw sourceError;
        },
      }),
    ).rejects.toBe(sourceError);
  });

  it('rejects unsafe root paths before invoking their source helper', async () => {
    const files = [
      {
        filename: '../unsafe.md',
        mimeType: 'text/markdown; charset=utf-8',
      },
    ] as const satisfies readonly DeterministicZipFile[];
    let called = false;
    await expect(
      createDeterministicZipResponse({
        label: 'unsafe fixture',
        filename: 'fixture.zip',
        mimeType: 'application/zip',
        files,
        sources: {
          '../unsafe.md': () => {
            called = true;
            return new Response('unsafe');
          },
        },
      }),
    ).rejects.toThrow(
      'source filename "../unsafe.md" is not a safe root entry',
    );
    expect(called).toBe(false);
  });
});
