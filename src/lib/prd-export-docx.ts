import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type FileChild,
} from 'docx';
import {
  createPrdTemplateDocument,
  type PrdTemplateStateInput,
  type SerializePrdMarkdownOptions,
} from './prd-template';

type BodyBlock =
  | { readonly kind: 'paragraph'; readonly lines: readonly string[] }
  | { readonly kind: 'bullet'; readonly text: string }
  | { readonly kind: 'number'; readonly marker: string; readonly text: string };

const FIXED_CORE_TIMESTAMP = '2000-01-01T00:00:00.000Z';
const FIXED_ZIP_DATE = 0x2821;

const bodyBlocks = (body: string): BodyBlock[] => {
  const blocks: BodyBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paragraph });
      paragraph = [];
    }
  };

  for (const line of body.split('\n')) {
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*(\d+[.)])\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: bullet[1] ?? '' });
    } else if (numbered) {
      flushParagraph();
      blocks.push({
        kind: 'number',
        marker: numbered[1] ?? '',
        text: numbered[2] ?? '',
      });
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  return blocks;
};

const textRuns = (lines: readonly string[]): TextRun[] =>
  lines.map(
    (line, index) =>
      new TextRun(index === 0 ? { text: line } : { text: line, break: 1 }),
  );

const bodyParagraphs = (body: string): Paragraph[] =>
  bodyBlocks(body).map((block) => {
    if (block.kind === 'bullet') {
      return new Paragraph({
        text: block.text,
        bullet: { level: 0 },
        spacing: { after: 80, line: 276 },
      });
    }
    if (block.kind === 'number') {
      return new Paragraph({
        text: `${block.marker} ${block.text}`,
        indent: { left: 360, hanging: 360 },
        spacing: { after: 80, line: 276 },
      });
    }
    return new Paragraph({
      children: textRuns(block.lines),
      spacing: { after: 160, line: 276 },
      widowControl: true,
    });
  });

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const coreProperties = (title: string): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/" ` +
  `xmlns:dcterms="http://purl.org/dc/terms/" ` +
  `xmlns:dcmitype="http://purl.org/dc/dcmitype/" ` +
  `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>${escapeXml(title)}</dc:title>` +
  `<dc:creator>PRD Template</dc:creator>` +
  `<cp:lastModifiedBy>PRD Template</cp:lastModifiedBy>` +
  `<cp:revision>1</cp:revision>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${FIXED_CORE_TIMESTAMP}</dcterms:created>` +
  `<dcterms:modified xsi:type="dcterms:W3CDTF">${FIXED_CORE_TIMESTAMP}</dcterms:modified>` +
  `</cp:coreProperties>`;

const normalizeZipTimestamps = (source: Uint8Array): Uint8Array => {
  const bytes = Uint8Array.from(source);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  let localFiles = 0;

  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, FIXED_ZIP_DATE, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    offset += 30 + nameLength + extraLength + compressedSize;
    localFiles += 1;
  }

  let centralFiles = 0;
  while (offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, FIXED_ZIP_DATE, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 46 + nameLength + extraLength + commentLength;
    centralFiles += 1;
  }

  if (
    localFiles === 0 ||
    localFiles !== centralFiles ||
    view.getUint32(offset, true) !== 0x06054b50
  ) {
    throw new Error('The generated Word package has an unexpected ZIP structure.');
  }
  return bytes;
};

export const exportPrdDocx = async (
  state: PrdTemplateStateInput,
  options: SerializePrdMarkdownOptions = {},
): Promise<Uint8Array> => {
  const document = createPrdTemplateDocument(state, options);
  const children: FileChild[] = [
    new Paragraph({
      text: document.title,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      spacing: { after: 320 },
    }),
  ];

  for (const section of document.sections) {
    children.push(
      new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_2,
        keepNext: true,
        spacing: { before: 240, after: 120 },
      }),
      ...bodyParagraphs(section.body),
    );
  }

  const file = new Document({
    title: document.title,
    creator: 'PRD Template',
    lastModifiedBy: 'PRD Template',
    revision: 1,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });
  const bytes = await Packer.pack(file, 'uint8array', false, [
    { path: 'docProps/core.xml', data: coreProperties(document.title) },
  ]);
  return normalizeZipTimestamps(bytes);
};
