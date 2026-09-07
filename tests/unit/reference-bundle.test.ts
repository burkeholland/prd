import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/lib/content.mjs';
import {
  createGuideMarkdownResponse,
  type GuideDownloadEntry,
} from '../../src/lib/guide-download';
import {
  createReferenceBundleResponse,
  REFERENCE_BUNDLE_FILENAME,
  REFERENCE_BUNDLE_FILES,
  REFERENCE_BUNDLE_MIME,
  REFERENCE_BUNDLE_UNIX_MODE,
  REFERENCE_BUNDLE_ZIP_DATE,
  REFERENCE_BUNDLE_ZIP_TIME,
  type ReferenceBundleSources,
} from '../../src/lib/reference-bundle';
import {
  createTemplateGuideMarkdownResponse,
  type TemplateGuideDownloadEntry,
} from '../../src/lib/template-guide';
import {
  createWalkthroughMarkdownResponse,
  type WalkthroughDownloadEntry,
} from '../../src/lib/walkthrough-download';
import { createHandoffChecklistResponse } from '../../src/pages/downloads/prd-handoff-checklist.md';
import { createPrdTemplateMarkdownResponse } from '../../src/pages/downloads/prd-template.md';

const contentEntry = (
  path: string,
): {
  data: { title: string; description: string };
  body: string;
} => {
  const parsed = parseFrontmatter(readFileSync(resolve(path), 'utf8'));
  if (
    !parsed.data ||
    !('title' in parsed.data) ||
    !('description' in parsed.data)
  ) {
    throw new Error(`${path} requires title and description frontmatter`);
  }
  const { title, description } = parsed.data;
  if (typeof title !== 'string' || typeof description !== 'string') {
    throw new Error(`${path} requires title and description frontmatter`);
  }
  return { data: { title, description }, body: parsed.body };
};

const guide = contentEntry('content/guide.md') satisfies GuideDownloadEntry;
const walkthrough = contentEntry(
  'content/walkthrough.md',
) satisfies WalkthroughDownloadEntry;
const templateGuide = contentEntry(
  'content/template.md',
) satisfies TemplateGuideDownloadEntry;

const sources = (): ReferenceBundleSources => ({
  'prd-guide.md': () => createGuideMarkdownResponse(guide),
  'prd-handoff-checklist.md': createHandoffChecklistResponse,
  'prd-example-walkthrough.md': () =>
    createWalkthroughMarkdownResponse(walkthrough),
  'prd-template-guide.md': () =>
    createTemplateGuideMarkdownResponse(templateGuide),
  'prd-template.md': createPrdTemplateMarkdownResponse,
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
  readonly externalAttributes: number;
  readonly localOffset: number;
}

const centralEntries = (bytes: Uint8Array): CentralEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = bytes.byteLength - 22;
  expect(view.getUint32(endOffset, true)).toBe(0x06054b50);
  expect(view.getUint16(endOffset + 8, true)).toBe(REFERENCE_BUNDLE_FILES.length);
  expect(view.getUint16(endOffset + 10, true)).toBe(REFERENCE_BUNDLE_FILES.length);
  expect(view.getUint16(endOffset + 20, true)).toBe(0);

  let offset = view.getUint32(endOffset + 16, true);
  const entries: CentralEntry[] = [];
  while (offset < endOffset) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const filename = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.slice(offset + 46, offset + 46 + nameLength),
    );
    entries.push({
      filename,
      versionMadeBy: view.getUint16(offset + 4, true),
      flags: view.getUint16(offset + 8, true),
      compression: view.getUint16(offset + 10, true),
      time: view.getUint16(offset + 12, true),
      date: view.getUint16(offset + 14, true),
      externalAttributes: view.getUint32(offset + 38, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  expect(offset).toBe(endOffset);
  return entries;
};

describe('Markdown reference bundle', () => {
  it('returns deterministic valid ZIP bytes with exact response and entry metadata', async () => {
    const first = await createReferenceBundleResponse(sources());
    const second = await createReferenceBundleResponse(sources());
    const bytes = await responseBytes(first);
    const repeated = await responseBytes(second);

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(REFERENCE_BUNDLE_MIME);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${REFERENCE_BUNDLE_FILENAME}"`,
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.slice(0, 4)).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(repeated).toEqual(bytes);

    const expectedNames = REFERENCE_BUNDLE_FILES.map(({ filename }) => filename);
    const metadata = centralEntries(bytes);
    expect(metadata.map(({ filename }) => filename)).toEqual(expectedNames);
    for (const entry of metadata) {
      expect(entry.filename).not.toMatch(/[\\/]/);
      expect(entry.versionMadeBy).toBe(0x0314);
      expect(entry.flags).toBe(0x0800);
      expect(entry.compression).toBe(0);
      expect(entry.time).toBe(REFERENCE_BUNDLE_ZIP_TIME);
      expect(entry.date).toBe(REFERENCE_BUNDLE_ZIP_DATE);
      expect(entry.externalAttributes).toBe(
        REFERENCE_BUNDLE_UNIX_MODE * 0x10000,
      );

      const local = new DataView(
        bytes.buffer,
        bytes.byteOffset + entry.localOffset,
      );
      expect(local.getUint32(0, true)).toBe(0x04034b50);
      expect(local.getUint16(6, true)).toBe(0x0800);
      expect(local.getUint16(8, true)).toBe(0);
      expect(local.getUint16(10, true)).toBe(REFERENCE_BUNDLE_ZIP_TIME);
      expect(local.getUint16(12, true)).toBe(REFERENCE_BUNDLE_ZIP_DATE);
      expect(local.getUint16(28, true)).toBe(0);
    }

    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expectedNames);
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);

    const standalone = sources();
    for (const { filename } of REFERENCE_BUNDLE_FILES) {
      const bundled = await zip.file(filename)?.async('uint8array');
      expect(bundled, filename).toBeDefined();
      expect(bundled).toEqual(await responseBytes(await standalone[filename]()));
    }
  });

  it('rejects an absent source helper without producing a partial archive', async () => {
    const { 'prd-guide.md': _guide, ...missingGuide } = sources();
    await expect(
      createReferenceBundleResponse(missingGuide),
    ).rejects.toThrow(
      'source helper for "prd-guide.md" is required',
    );
  });

  it.each([
    {
      failure: 'non-200 response',
      response: new Response('failed', {
        status: 503,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="prd-guide.md"',
        },
      }),
      message: 'returned status 503; expected 200',
    },
    {
      failure: 'wrong MIME',
      response: new Response('content', {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="prd-guide.md"',
        },
      }),
      message: 'returned MIME "text/plain; charset=utf-8"',
    },
    {
      failure: 'empty bytes',
      response: new Response(new Uint8Array(), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="prd-guide.md"',
        },
      }),
      message: 'returned empty bytes',
    },
    {
      failure: 'wrong filename',
      response: new Response('content', {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="other.md"',
        },
      }),
      message: 'returned filename "other.md"; expected "prd-guide.md"',
    },
  ])('rejects a $failure source explicitly', async ({ response, message }) => {
    await expect(
      createReferenceBundleResponse({
        ...sources(),
        'prd-guide.md': () => response,
      }),
    ).rejects.toThrow(message);
  });

  it('propagates source helper errors instead of returning fallback bytes', async () => {
    const sourceError = new Error('Guide source unavailable');
    await expect(
      createReferenceBundleResponse({
        ...sources(),
        'prd-guide.md': () => {
          throw sourceError;
        },
      }),
    ).rejects.toBe(sourceError);
  });
});
