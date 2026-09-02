import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import {
  createPrdTemplateDocument,
  type PrdTemplateStateInput,
  type SerializePrdMarkdownOptions,
} from './prd-template';

export interface PrdPdfFonts {
  readonly regular: Uint8Array;
  readonly bold: Uint8Array;
}

export interface PrdPdfLayoutLine {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly role: 'title' | 'section' | 'body' | 'list';
  readonly text: string;
}

export interface GeneratedPrdPdf {
  readonly bytes: Uint8Array;
  readonly layout: readonly PrdPdfLayoutLine[];
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FIXED_DATE = new Date('2000-01-01T00:00:00.000Z');

const printableText = (value: string): string =>
  value
    .replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

const splitLongWord = (
  word: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number,
): string[] => {
  const pieces: string[] = [];
  let piece = '';
  for (const character of Array.from(word)) {
    const candidate = piece + character;
    if (piece && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
};

const wrapText = (
  value: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number,
): string[] => {
  const words = printableText(value).trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const pieces =
      font.widthOfTextAtSize(word, fontSize) > maxWidth
        ? splitLongWord(word, maxWidth, font, fontSize)
        : [word];
    for (const piece of pieces) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (line && font.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
        lines.push(line);
        line = piece;
      } else {
        line = candidate;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
};

export const generatePrdPdf = async (
  state: PrdTemplateStateInput,
  fonts: PrdPdfFonts,
  options: SerializePrdMarkdownOptions = {},
): Promise<GeneratedPrdPdf> => {
  const document = createPrdTemplateDocument(state, options);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(document.title);
  pdf.setAuthor('PRD Guide');
  pdf.setCreator('PRD Guide');
  pdf.setProducer('PRD Guide');
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);

  const regular = await pdf.embedFont(fonts.regular, { subset: true });
  const bold = await pdf.embedFont(fonts.bold, { subset: true });
  const layout: PrdPdfLayoutLine[] = [];
  let page: PDFPage;
  let pageNumber = 0;
  let y = 0;

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensureSpace = (height: number) => {
    if (y - height < MARGIN) addPage();
  };
  const gap = (height: number) => {
    ensureSpace(height);
    y -= height;
  };
  const drawLines = (
    lines: readonly string[],
    {
      font,
      fontSize,
      lineHeight,
      role,
      indent = 0,
    }: {
      readonly font: PDFFont;
      readonly fontSize: number;
      readonly lineHeight: number;
      readonly role: PrdPdfLayoutLine['role'];
      readonly indent?: number;
    },
  ) => {
    for (const line of lines) {
      ensureSpace(lineHeight);
      const x = MARGIN + indent;
      page.drawText(line, {
        x,
        y: y - fontSize,
        size: fontSize,
        font,
        color: rgb(0.11, 0.12, 0.14),
      });
      layout.push({
        page: pageNumber,
        x,
        y: y - fontSize,
        fontSize,
        lineHeight,
        role,
        text: line,
      });
      y -= lineHeight;
    }
  };
  const drawWrapped = (
    text: string,
    config: {
      readonly font: PDFFont;
      readonly fontSize: number;
      readonly lineHeight: number;
      readonly role: PrdPdfLayoutLine['role'];
      readonly indent?: number;
    },
  ) => {
    const indent = config.indent ?? 0;
    drawLines(
      wrapText(text, CONTENT_WIDTH - indent, config.font, config.fontSize),
      config,
    );
  };

  addPage();
  drawWrapped(document.title, {
    font: bold,
    fontSize: 20,
    lineHeight: 26,
    role: 'title',
  });
  gap(16);

  for (const section of document.sections) {
    ensureSpace(42);
    drawWrapped(section.title, {
      font: bold,
      fontSize: 14,
      lineHeight: 19,
      role: 'section',
    });
    gap(7);

    const lines = section.body.split('\n');
    for (const line of lines) {
      if (!line.trim()) {
        gap(8);
        continue;
      }
      const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
      const numbered = /^\s*(\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        drawWrapped(`• ${bullet[1] ?? ''}`, {
          font: regular,
          fontSize: 10.5,
          lineHeight: 15,
          role: 'list',
          indent: 14,
        });
      } else if (numbered) {
        drawWrapped(`${numbered[1] ?? ''} ${numbered[2] ?? ''}`, {
          font: regular,
          fontSize: 10.5,
          lineHeight: 15,
          role: 'list',
          indent: 14,
        });
      } else {
        drawWrapped(line, {
          font: regular,
          fontSize: 10.5,
          lineHeight: 15,
          role: 'body',
        });
      }
    }
    gap(15);
  }

  return {
    bytes: await pdf.save({ useObjectStreams: false }),
    layout,
  };
};
