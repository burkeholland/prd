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
import { parseExamplePrdMarkdown } from '../../src/lib/example-prd';
import { PRD_EXPORT_MIME_TYPES } from '../../src/lib/prd-export';
import {
  parsePrdExportMarkdown,
  scanMarkdownStructure,
} from '../../src/lib/prd-export-document';
import {
  normalizePrdLineEndings,
  normalizePrdSectionValue,
  PRD_TEMPLATE_SECTIONS,
} from '../../src/lib/prd-template';
import { createBuildTheUrlistDocxResponse } from '../../src/pages/downloads/build-the-urlist.docx';
import { createBuildTheUrlistPdfResponse } from '../../src/pages/downloads/build-the-urlist.pdf';

const SOURCE_PATH = resolve('content/gist/build-the-urlist.md');
const SOURCE_SECTION_TITLES = [
  'Mocks',
  'Technical specification and checklist',
  'Stack and design',
  'Product',
  'Routes',
  'Home page',
  'Draft and editor',
  'Live metadata',
  'Aliases and publication',
  'Login and ownership',
  'My Lists',
  'Delete',
  'Public list',
  'Theme, responsive UI, and accessibility',
  'Storage and security',
  'Scripts, tests, and documentation',
  'Completion',
] as const;
const PLACEHOLDERS = PRD_TEMPLATE_SECTIONS.map(
  (section) => `{${section.title}}`,
);
const SOURCE_SECTION_TITLE_SET = new Set<string>(SOURCE_SECTION_TITLES);
const FABRICATED_CANONICAL_TITLES = PRD_TEMPLATE_SECTIONS.map(
  (section) => section.title,
).filter((title) => !SOURCE_SECTION_TITLE_SET.has(title));

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

const paragraphHeadings = (
  documentXml: string,
  style: 'Heading1' | 'Heading2',
): string[] =>
  Array.from(
    documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
    (match) => match[0],
  )
    .filter((paragraph) =>
      paragraph.includes(`w:pStyle w:val="${style}"`),
    )
    .map(xmlText);

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

const expectedSourceBodies = (source: string): string[] => {
  const lines = normalizePrdLineEndings(source).split('\n');
  const headings = scanMarkdownStructure(lines).headings.filter(
    (heading) => heading.level === 2,
  );
  return headings.map((heading, index) =>
    normalizePrdSectionValue(
      lines
        .slice(heading.line + 1, headings[index + 1]?.line ?? lines.length)
        .join('\n'),
    ),
  );
};

describe('worked Example Markdown document parsing', () => {
  it('preserves the exact title, preamble, 17 source headings, and 17 normalized bodies', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const document = parseExamplePrdMarkdown(source);

    expect(document.title).toBe('Build The Urlist');
    expect(document.preamble).toBe(
      'Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.',
    );
    expect(document.sections.map(({ title }) => title)).toEqual(
      SOURCE_SECTION_TITLES,
    );
    expect(document.sections.map(({ body }) => body)).toEqual(
      expectedSourceBodies(source),
    );
    expect(document.sections).toHaveLength(17);
    for (const title of FABRICATED_CANONICAL_TITLES) {
      expect(document.sections.map((section) => section.title)).not.toContain(
        title,
      );
    }
  });

  it('normalizes CRLF deliberately and ignores apparent headings inside fences', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const normalized = normalizePrdLineEndings(source);
    expect(
      parseExamplePrdMarkdown(normalized.replace(/\n/g, '\r\n')),
    ).toEqual(parseExamplePrdMarkdown(normalized));

    const fenced = [
      '# Real title',
      '',
      '```md',
      '# Not another title',
      '## Not a section',
      '```',
      '',
      '## Real section',
      '',
      'Body',
    ].join('\n');
    expect(parsePrdExportMarkdown(fenced)).toEqual({
      status: 'valid',
      document: {
        title: 'Real title',
        preamble: '```md\n# Not another title\n## Not a section\n```',
        sections: [{ title: 'Real section', body: 'Body' }],
      },
    });
  });

  it.each([
    ['missing-title', 'Body\n\n## Section\n\nText'],
    ['multiple-titles', '# One\n\n# Two\n\n## Section\n\nText'],
    ['content-before-title', 'Body\n\n# Title\n\n## Section\n\nText'],
    ['missing-sections', '# Title\n\nBody'],
    ['empty-section-title', '# Title\n\n## \n\nBody'],
    ['unclosed-fence', '# Title\n\n## Section\n\n```md\nBody'],
  ] as const)('reports an explicit %s source error', (reason, source) => {
    expect(() => parseExamplePrdMarkdown(source)).toThrow(
      `Example download generation failed: content/gist/build-the-urlist.md could not be parsed (${reason}).`,
    );
  });
});

describe('prerendered Example downloads', () => {
  it('returns deterministic, parseable DOCX responses with exact metadata and all source sections', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const document = parseExamplePrdMarkdown(source);
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
    expect(paragraphHeadings(documentXml, 'Heading1')).toEqual([
      document.title,
    ]);
    expect(paragraphHeadings(documentXml, 'Heading2')).toEqual(
      SOURCE_SECTION_TITLES,
    );
    expect(text).toContain(compact(document.preamble ?? ''));
    for (const section of document.sections) {
      expect(text, section.title).toContain(
        compact(representativeText(section.body)),
      );
    }
    for (const value of PLACEHOLDERS) {
      expect(text).not.toContain(compact(value));
    }
    for (const value of FABRICATED_CANONICAL_TITLES) {
      expect(paragraphHeadings(documentXml, 'Heading2')).not.toContain(value);
    }
  });

  it('returns deterministic, parseable PDF responses with exact metadata and all source sections', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const document = parseExamplePrdMarkdown(source);
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
      ...SOURCE_SECTION_TITLES,
    ]);

    const text = compact(await pdfText(bytes));
    expect(text).toContain(compact(document.preamble ?? ''));
    for (const section of document.sections) {
      expect(text, section.title).toContain(
        compact(representativeText(section.body)),
      );
    }
    for (const value of PLACEHOLDERS) {
      expect(text).not.toContain(compact(value));
    }
    for (const value of FABRICATED_CANONICAL_TITLES) {
      expect(pdfOutlineTitles(parsed)).not.toContain(value);
    }
  });
});
