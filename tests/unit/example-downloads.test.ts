import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeExamplePrdMarkdown,
  parseExamplePrdMarkdown,
} from '../../src/lib/example-prd';
import { parsePrdMarkdown } from '../../src/lib/prd-import-markdown';
import { PRD_EXPORT_MIME_TYPES } from '../../src/lib/prd-export';
import { createPrdTemplateDocument, PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import { createBuildTheUrlistDocxResponse } from '../../src/pages/downloads/build-the-urlist.docx';
import { createBuildTheUrlistPdfResponse } from '../../src/pages/downloads/build-the-urlist.pdf';

const SOURCE_PATH = resolve('content/gist/build-the-urlist.md');
const PLACEHOLDERS = PRD_TEMPLATE_SECTIONS.map(
  (section) => `{${section.title}}`,
);

const xmlText = (xml: string): string =>
  xml
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const compact = (value: string): string => value.replace(/\s+/gu, '');

const representativeText = (body: string): string => {
  const line = body
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('#'));
  if (!line) throw new Error('Expected every Example section to have body text.');
  return line.slice(0, 48);
};

const pdfOutlineTitles = (pdf: PDFDocument): string[] => {
  const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const titles: string[] = [];
  let item = root.lookupMaybe(PDFName.of('First'), PDFDict);
  while (item) {
    titles.push(
      item.lookup(PDFName.of('Title'), PDFString, PDFHexString).decodeText(),
    );
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return titles;
};

const pdfText = async (bytes: Uint8Array): Promise<string> => {
  const loading = getDocument({ data: bytes, useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ('str' in item ? item.str : '')).join(' '),
      );
    }
    return pages.join('\n');
  } finally {
    await loading.destroy();
  }
};

describe('prerendered Example downloads', () => {
  it('derives one title and all canonical section values through parsePrdMarkdown', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const canonical = canonicalizeExamplePrdMarkdown(source);
    const parsed = parsePrdMarkdown(canonical);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid') throw new Error(parsed.reason);

    const state = parseExamplePrdMarkdown(source);
    const document = createPrdTemplateDocument(state);
    expect(document.title).toBe('Build The Urlist');
    expect(document.sections.map(({ title }) => title)).toEqual(
      PRD_TEMPLATE_SECTIONS.map(({ title }) => title),
    );
    expect(document.sections.map(({ body }) => body)).toEqual(
      PRD_TEMPLATE_SECTIONS.map(({ id }) => parsed.state.values[id]),
    );
    expect(document.sections.every(({ body }) => body.length > 0)).toBe(true);
  });

  it('reports an explicit source parsing error instead of producing a partial document', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    expect(() =>
      parseExamplePrdMarkdown(source.replace(/^# Build The Urlist$/m, '')),
    ).toThrow(
      'Example download generation failed: content/gist/build-the-urlist.md could not be parsed (missing-title).',
    );
  });

  it('returns deterministic, parseable DOCX responses with exact attachment metadata and source content', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const document = createPrdTemplateDocument(
      parseExamplePrdMarkdown(source),
    );
    const first = await createBuildTheUrlistDocxResponse();
    const second = await createBuildTheUrlistDocxResponse();
    const bytes = new Uint8Array(await first.arrayBuffer());
    const repeated = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(
      PRD_EXPORT_MIME_TYPES.docx,
    );
    expect(first.headers.get('content-disposition')).toBe(
      'attachment; filename="build-the-urlist.docx"',
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(repeated).toEqual(bytes);

    const zip = await JSZip.loadAsync(bytes);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/styles.xml',
    ]) {
      expect(zip.file(part), part).not.toBeNull();
    }
    const documentXml = await zip.file('word/document.xml')!.async('text');
    const text = compact(xmlText(documentXml));
    expect(documentXml.match(/w:pStyle w:val="Heading1"/g)).toHaveLength(1);
    expect(documentXml.match(/w:pStyle w:val="Heading2"/g)).toHaveLength(12);

    let previous = -1;
    for (const section of document.sections) {
      const heading = text.indexOf(compact(section.title));
      expect(heading, section.title).toBeGreaterThan(previous);
      previous = heading;
      expect(text, section.title).toContain(
        compact(representativeText(section.body)),
      );
    }
    expect(text).toContain(compact(document.title));
    for (const placeholder of PLACEHOLDERS) {
      expect(text).not.toContain(compact(placeholder));
    }
  });

  it('returns deterministic, parseable PDF responses with exact attachment metadata and source content', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const document = createPrdTemplateDocument(
      parseExamplePrdMarkdown(source),
    );
    const first = await createBuildTheUrlistPdfResponse();
    const second = await createBuildTheUrlistPdfResponse();
    const bytes = new Uint8Array(await first.arrayBuffer());
    const repeated = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(PRD_EXPORT_MIME_TYPES.pdf);
    expect(first.headers.get('content-disposition')).toBe(
      'attachment; filename="build-the-urlist.pdf"',
    );
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(repeated).toEqual(bytes);

    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toBe(document.title);
    expect(pdfOutlineTitles(parsed)).toEqual([
      document.title,
      ...document.sections.map(({ title }) => title),
    ]);

    const text = compact(await pdfText(bytes));
    let previous = -1;
    for (const section of document.sections) {
      const heading = text.indexOf(compact(section.title));
      expect(heading, section.title).toBeGreaterThan(previous);
      previous = heading;
      expect(text, section.title).toContain(
        compact(representativeText(section.body)),
      );
    }
    expect(text).toContain(compact(document.title));
    for (const placeholder of PLACEHOLDERS) {
      expect(text).not.toContain(compact(placeholder));
    }
  });
});
