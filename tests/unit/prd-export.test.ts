import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import fontkit from '@pdf-lib/fontkit';
import JSZip from 'jszip';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  exportPrdMarkdown,
  prdExportFilename,
  sanitizePrdFilename,
} from '../../src/lib/prd-export';
import { exportPrdDocx } from '../../src/lib/prd-export-docx';
import { generatePrdPdf } from '../../src/lib/prd-export-pdf';
import {
  PRD_TEMPLATE,
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateSectionId,
  type PrdTemplateState,
} from '../../src/lib/prd-template';

const require = createRequire(import.meta.url);
const font = (weight: 400 | 700) =>
  readFile(
    require.resolve(
      `@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff`,
    ),
  );

const VALUES = Object.fromEntries(
  PRD_TEMPLATE_SECTIONS.map((section, index) => [
    section.id,
    index === 0
      ? 'Outcome: “Café” — 50% & rising.\r\nKeep this intentional second line.\r\n\r\n- First item\r\n- Deuxième item\r\n1. Ordered item'
      : `Decision ${index + 1}: preserve ${section.id}.`,
  ]),
) as Record<PrdTemplateSectionId, string>;

const FILLED_STATE: PrdTemplateState = {
  title: 'Launch: Café / Q4 2026?',
  values: VALUES,
};

const MIXED_STATE: PrdTemplateState = {
  title: '  Focused export  ',
  values: Object.fromEntries(
    PRD_TEMPLATE_SECTIONS.map((section, index) => [
      section.id,
      index === 1
        ? 'First retained section.'
        : index === 6
          ? 'Second retained section.\r\nWith another line.'
          : index === 10
            ? 'Third retained section.'
            : index === 4
              ? ' \t\r\n '
              : '',
    ]),
  ) as Record<PrdTemplateSectionId, string>,
};
const MIXED_SECTION_TITLES = [1, 6, 10].map(
  (index) => PRD_TEMPLATE_SECTIONS[index]!.title,
);
const TITLE_ONLY_STATE: PrdTemplateState = {
  title: ' \r\n ',
  values: Object.fromEntries(
    PRD_TEMPLATE_SECTIONS.map((section) => [section.id, ' \t ']),
  ) as Record<PrdTemplateSectionId, string>,
};
const OMIT_BLANK_SECTIONS = { includeBlankSections: false } as const;

const xmlText = (xml: string): string =>
  xml
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const pdfOutlineTitles = (pdf: PDFDocument): string[] => {
  const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const titles: string[] = [];
  let item = root.lookupMaybe(PDFName.of('First'), PDFDict);
  while (item) {
    titles.push(
      item
        .lookup(PDFName.of('Title'), PDFString, PDFHexString)
        .decodeText(),
    );
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return titles;
};

describe('PRD export names and Markdown', () => {
  it('sanitizes titles and uses the documented empty-title fallback', () => {
    expect(sanitizePrdFilename('  Launch: Café / Q4 2026?  ')).toBe(
      'launch-cafe-q4-2026',
    );
    expect(prdExportFilename('', 'docx')).toBe(
      'product-requirements-document.docx',
    );
  });

  it('emits deterministic UTF-8 with one H1, 12 ordered H2s, LF endings, and filled Unicode content', () => {
    const first = exportPrdMarkdown(FILLED_STATE);
    const second = exportPrdMarkdown(FILLED_STATE);
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(first);

    expect(second).toEqual(first);
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(Array.from(markdown.matchAll(/^## (.+)$/gm), (match) => match[1])).toEqual(
      PRD_TEMPLATE_SECTIONS.map((section) => section.title),
    );
    expect(markdown).toContain('Outcome: “Café” — 50% & rising.');
    expect(markdown).toContain('Keep this intentional second line.\n\n- First item');
    expect(markdown).toContain('- Deuxième item\n1. Ordered item');
    expect(markdown).not.toContain('\r');
  });

  it('emits only filled sections in canonical order when blank sections are omitted', () => {
    const markdown = new TextDecoder().decode(
      exportPrdMarkdown(MIXED_STATE, OMIT_BLANK_SECTIONS),
    );

    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(Array.from(markdown.matchAll(/^## (.+)$/gm), (match) => match[1])).toEqual(
      MIXED_SECTION_TITLES,
    );
    expect(markdown).toContain('Second retained section.\nWith another line.');
    expect(markdown).not.toContain(PRD_TEMPLATE_SECTIONS[4]!.title);
  });

  it('emits a normalized title and no headings for an otherwise blank document', () => {
    const markdown = new TextDecoder().decode(
      exportPrdMarkdown(TITLE_ONLY_STATE, OMIT_BLANK_SECTIONS),
    );

    expect(markdown).toBe(`# ${PRD_TEMPLATE.defaultTitle}\n`);
  });
});

describe('Word export', () => {
  it('is deterministic OOXML with required parts, heading hierarchy, and all filled content', async () => {
    const first = await exportPrdDocx(FILLED_STATE);
    const second = await exportPrdDocx(FILLED_STATE);
    expect(second).toEqual(first);
    expect(Array.from(first.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const zip = await JSZip.loadAsync(first);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
      'word/styles.xml',
    ]) {
      expect(zip.file(part), part).not.toBeNull();
    }

    const documentXml = await zip.file('word/document.xml')!.async('text');
    const text = xmlText(documentXml);
    expect(documentXml.match(/w:pStyle w:val="Heading1"/g)).toHaveLength(1);
    expect(documentXml.match(/w:pStyle w:val="Heading2"/g)).toHaveLength(12);
    expect(text).toContain(FILLED_STATE.title);
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(text, section.id).toContain(section.title);
    }
    expect(text).toContain('Outcome: “Café” — 50% & rising.');
    expect(text).toContain('Keep this intentional second line.');
    expect(text).toContain('Deuxième item');

    const core = await zip.file('docProps/core.xml')!.async('text');
    expect(core.match(/2000-01-01T00:00:00.000Z/g)).toHaveLength(2);
  });

  it('contains only filled headings in canonical order and supports title-only output', async () => {
    const mixedZip = await JSZip.loadAsync(
      await exportPrdDocx(MIXED_STATE, OMIT_BLANK_SECTIONS),
    );
    const mixedXml = await mixedZip.file('word/document.xml')!.async('text');
    const mixedText = xmlText(mixedXml);

    expect(mixedXml.match(/w:pStyle w:val="Heading1"/g)).toHaveLength(1);
    expect(mixedXml.match(/w:pStyle w:val="Heading2"/g)).toHaveLength(3);
    let previousIndex = -1;
    for (const title of MIXED_SECTION_TITLES) {
      const index = mixedText.indexOf(title);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
    expect(mixedText).not.toContain(PRD_TEMPLATE_SECTIONS[4]!.title);

    const titleOnlyZip = await JSZip.loadAsync(
      await exportPrdDocx(TITLE_ONLY_STATE, OMIT_BLANK_SECTIONS),
    );
    const titleOnlyXml = await titleOnlyZip.file('word/document.xml')!.async('text');
    expect(titleOnlyXml.match(/w:pStyle w:val="Heading1"/g)).toHaveLength(1);
    expect(titleOnlyXml.match(/w:pStyle w:val="Heading2"/g)).toBeNull();
    expect(xmlText(titleOnlyXml)).toContain(PRD_TEMPLATE.defaultTitle);
  });
});

describe('PDF export', () => {
  it('is deterministic, reloadable, paginated, selectable, and lays out every heading without clipping', async () => {
    const [regular, bold] = await Promise.all([font(400), font(700)]);
    for (const face of [fontkit.create(regular), fontkit.create(bold)]) {
      for (const character of 'Product requirements document “Café” — 50%') {
        expect(
          face.hasGlyphForCodePoint(character.codePointAt(0)!),
          `font contains ${character}`,
        ).toBe(true);
      }
    }
    const first = await generatePrdPdf(FILLED_STATE, { regular, bold });
    const second = await generatePrdPdf(FILLED_STATE, { regular, bold });
    expect(second.bytes).toEqual(first.bytes);
    expect(new TextDecoder().decode(first.bytes.slice(0, 5))).toBe('%PDF-');

    const parsed = await PDFDocument.load(first.bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdfOutlineTitles(parsed)).toEqual([
      FILLED_STATE.title,
      ...PRD_TEMPLATE_SECTIONS.map((section) => section.title),
    ]);
    expect(first.layout.length).toBeGreaterThan(PRD_TEMPLATE_SECTIONS.length);

    const laidOutText = first.layout.map((line) => line.text).join(' ');
    expect(laidOutText).toContain(FILLED_STATE.title);
    expect(laidOutText).toContain('“Café” — 50% & rising.');
    expect(laidOutText).toContain('Deuxième item');
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(laidOutText, section.id).toContain(section.title);
    }

    for (const line of first.layout) {
      expect(line.x).toBeGreaterThanOrEqual(54);
      expect(line.y).toBeGreaterThanOrEqual(54);
      expect(line.y + line.fontSize).toBeLessThanOrEqual(792 - 54);
    }
    for (let index = 1; index < first.layout.length; index += 1) {
      const previous = first.layout[index - 1]!;
      const line = first.layout[index]!;
      if (line.page === previous.page) {
        expect(line.y, `${line.text} does not overlap ${previous.text}`).toBeLessThan(
          previous.y,
        );
      }
    }
  });

  it('rejects unsupported PDF glyphs instead of silently drawing missing-glyph boxes', async () => {
    const [regular, bold] = await Promise.all([font(400), font(700)]);
    await expect(
      generatePrdPdf({ ...FILLED_STATE, title: 'Launch 🚀' }, { regular, bold }),
    ).rejects.toThrow('PDF heading font cannot render U+1F680');
  });

  it('outlines only filled sections in canonical order and supports title-only output', async () => {
    const [regular, bold] = await Promise.all([font(400), font(700)]);
    const mixed = await generatePrdPdf(
      MIXED_STATE,
      { regular, bold },
      OMIT_BLANK_SECTIONS,
    );
    const mixedPdf = await PDFDocument.load(mixed.bytes);

    expect(pdfOutlineTitles(mixedPdf)).toEqual([
      'Focused export',
      ...MIXED_SECTION_TITLES,
    ]);
    expect(
      mixed.layout.filter((line) => line.role === 'section').map((line) => line.text),
    ).toEqual(MIXED_SECTION_TITLES);

    const titleOnly = await generatePrdPdf(
      TITLE_ONLY_STATE,
      { regular, bold },
      OMIT_BLANK_SECTIONS,
    );
    const titleOnlyPdf = await PDFDocument.load(titleOnly.bytes);
    expect(titleOnlyPdf.getPageCount()).toBe(1);
    expect(pdfOutlineTitles(titleOnlyPdf)).toEqual([PRD_TEMPLATE.defaultTitle]);
    expect(titleOnly.layout.filter((line) => line.role === 'section')).toEqual([]);
    expect(titleOnly.layout.filter((line) => line.role === 'title').map((line) => line.text))
      .toEqual([PRD_TEMPLATE.defaultTitle]);
  });
});
