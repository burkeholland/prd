import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import JSZip from 'jszip';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import {
  PRD_EXPORT_MIME_TYPES,
} from '../../src/lib/prd-export';
import {
  PRD_TEMPLATE,
  PRD_TEMPLATE_SECTIONS,
} from '../../src/lib/prd-template';

const CREATE_PATH = '/prd/';
const SENTINEL = 'PRIVATE-DRAFT-SENTINEL-8251';

const bytesFrom = async (download: Download): Promise<Buffer> => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const captureDownloadMime = async (page: Page) => {
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    const windowWithMime = window as typeof window & {
      __prdDownloadMime?: string;
    };
    URL.createObjectURL = (object) => {
      windowWithMime.__prdDownloadMime =
        object instanceof Blob ? object.type : '';
      return original(object);
    };
  });
};

const clickDownload = async (page: Page, id: string) => {
  const pending = page.waitForEvent('download');
  await page.locator(id).click();
  const download = await pending;
  const mime = await page.evaluate(
    () =>
      (window as typeof window & { __prdDownloadMime?: string })
        .__prdDownloadMime ?? '',
  );
  return { download, mime };
};

const xmlText = (xml: string): string =>
  xml
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const parseDocx = async (bytes: Buffer) => {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file('word/document.xml')!.async('text');
  const paragraphs = Array.from(
    documentXml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
    (match) => match[0],
  );
  const headings = (style: 'Heading1' | 'Heading2') =>
    paragraphs
      .filter((paragraph) =>
        paragraph.includes(`w:pStyle w:val="${style}"`),
      )
      .map(xmlText);
  return {
    title: headings('Heading1'),
    sections: headings('Heading2'),
    text: xmlText(documentXml),
  };
};

const parsePdf = async (bytes: Buffer) => {
  const pdf = await PDFDocument.load(bytes);
  const root = pdf.catalog.lookup(PDFName.of('Outlines'), PDFDict);
  const outline: string[] = [];
  let item = root.lookupMaybe(PDFName.of('First'), PDFDict);
  while (item) {
    outline.push(
      item
        .lookup(PDFName.of('Title'), PDFString, PDFHexString)
        .decodeText(),
    );
    item = item.lookupMaybe(PDFName.of('Next'), PDFDict);
  }
  return {
    title: pdf.getTitle(),
    outline,
    pages: pdf.getPageCount(),
  };
};

const sectionTitles = PRD_TEMPLATE_SECTIONS.map((section) => section.title);

test('all three stable blank-template URLs return parseable files with canonical structure', async ({
  page,
  request,
}, testInfo) => {
  const files = [
    {
      path: '/prd/downloads/prd-template.md',
      type: 'text/markdown',
      name: 'prd-template.md',
      signature: Buffer.from('# Product requirements document'),
    },
    {
      path: '/prd/downloads/prd-template.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'prd-template.docx',
      signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    {
      path: '/prd/downloads/prd-template.pdf',
      type: 'application/pdf',
      name: 'prd-template.pdf',
      signature: Buffer.from('%PDF-'),
    },
  ] as const;
  const sizes: string[] = [];

  for (const file of files) {
    const response = await request.get(file.path);
    const body = await response.body();
    expect(response.status(), file.path).toBe(200);
    expect(response.headers()['content-type'], file.path).toContain(file.type);
    expect(body.byteLength, file.path).toBeGreaterThan(0);
    expect(body.subarray(0, file.signature.length), file.path).toEqual(file.signature);
    sizes.push(`${file.name} ${body.byteLength} bytes`);

    if (file.path.endsWith('.md')) {
      const markdown = new TextDecoder('utf-8', { fatal: true }).decode(body);
      expect(Array.from(markdown.matchAll(/^# (.+)$/gm), (match) => match[1])).toEqual([
        PRD_TEMPLATE.defaultTitle,
      ]);
      expect(Array.from(markdown.matchAll(/^## (.+)$/gm), (match) => match[1])).toEqual(
        sectionTitles,
      );
    } else if (file.path.endsWith('.docx')) {
      const word = await parseDocx(body);
      expect(word.title).toEqual([PRD_TEMPLATE.defaultTitle]);
      expect(word.sections).toEqual(sectionTitles);
    } else {
      const pdf = await parsePdf(body);
      expect(pdf.title).toBe(PRD_TEMPLATE.defaultTitle);
      expect(pdf.outline).toEqual([
        PRD_TEMPLATE.defaultTitle,
        ...sectionTitles,
      ]);
      expect(pdf.pages).toBeGreaterThan(0);
    }
  }

  await page.goto(CREATE_PATH);
  for (const file of files) {
    const extension = file.name.slice(file.name.lastIndexOf('.') + 1);
    const { download } = await clickDownload(
      page,
      `#blank-download-${extension}`,
    );
    expect(download.suggestedFilename(), file.path).toBe(file.name);
    expect((await bytesFrom(download)).byteLength, file.path).toBeGreaterThan(0);
  }

  testInfo.annotations.push({
    type: 'blank artifact sizes',
    description: sizes.join(' · '),
  });
});

test('all 13 draft values download as parseable Markdown, Word, and PDF without a network payload', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });
  await page.goto(CREATE_PATH);
  await captureDownloadMime(page);

  const title = 'Launch: Café / Q4 2026?';
  const values = PRD_TEMPLATE_SECTIONS.map((_, index) =>
    index === 0
      ? `${SENTINEL}: “Café” — 50% & rising.\nSecond line stays.\n\n- First item\n- Deuxième item\n1. Ordered item`
      : `${SENTINEL} decision ${index + 1}.`,
  );
  await page.locator('#document-title').fill(title);
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await page
      .locator(`#section-input-${section.id}`)
      .fill(values[index]!);
  }
  const sizes: string[] = [];

  const { download: markdownDownload, mime: markdownMime } =
    await clickDownload(page, '#download-md');
  expect(markdownDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.md');
  expect(markdownMime).toBe(PRD_EXPORT_MIME_TYPES.md);
  const markdownBytes = await bytesFrom(markdownDownload);
  sizes.push(`md ${markdownBytes.byteLength} bytes`);
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes);
  expect(Array.from(markdown.matchAll(/^# (.+)$/gm), (match) => match[1])).toEqual([
    title,
  ]);
  expect(Array.from(markdown.matchAll(/^## (.+)$/gm), (match) => match[1])).toEqual(
    sectionTitles,
  );
  expect(markdown).toContain('Second line stays.\n\n- First item\n- Deuxième item');
  for (const value of values) expect(markdown).toContain(value);

  const { download: wordDownload, mime: wordMime } =
    await clickDownload(page, '#download-docx');
  expect(wordDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.docx');
  expect(wordMime).toBe(PRD_EXPORT_MIME_TYPES.docx);
  const wordBytes = await bytesFrom(wordDownload);
  sizes.push(`docx ${wordBytes.byteLength} bytes`);
  expect(wordBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const word = await parseDocx(wordBytes);
  expect(word.title).toEqual([title]);
  expect(word.sections).toEqual(sectionTitles);
  for (const value of values) {
    for (const line of value.split('\n').map((part) => part.trim()).filter(Boolean)) {
      expect(word.text).toContain(
        line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, ''),
      );
    }
  }

  const { download: pdfDownload, mime: pdfMime } =
    await clickDownload(page, '#download-pdf');
  expect(pdfDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.pdf');
  expect(pdfMime).toBe(PRD_EXPORT_MIME_TYPES.pdf);
  const pdfBytes = await bytesFrom(pdfDownload);
  sizes.push(`pdf ${pdfBytes.byteLength} bytes`);
  expect(pdfBytes.subarray(0, 5)).toEqual(Buffer.from('%PDF-'));
  const pdf = await parsePdf(pdfBytes);
  expect(pdf.title).toBe(title);
  expect(pdf.outline).toEqual([title, ...sectionTitles]);
  expect(pdf.pages).toBeGreaterThan(0);

  await expect(page.locator('#download-status')).toHaveText(
    'Downloaded launch-cafe-q4-2026.pdf.',
  );
  await expect(page.locator('#document-title')).toHaveValue(
    'Launch: Café / Q4 2026?',
  );
  await expect(page.locator('#section-input-summary-outcome')).toHaveValue(
    new RegExp(SENTINEL),
  );
  expect(requests.join('\n')).not.toContain(SENTINEL);
  expect(requests.every((request) => !/POST|PUT|PATCH/.test(request))).toBe(true);
  testInfo.annotations.push({
    type: 'current draft sizes',
    description: sizes.join(' · '),
  });
});

test('a generation failure is explicit and leaves the current draft intact', async ({
  page,
}) => {
  await page.goto(CREATE_PATH);
  await page.route('**/*.woff', (route) => route.abort());
  await page.locator('#document-title').fill('Keep this title');
  await page
    .locator('#section-input-summary-outcome')
    .fill('Keep this section after the failed export.');

  await page.locator('#download-pdf').click();
  await expect(page.locator('#download-status')).toHaveText(
    'Download failed for keep-this-title.pdf. Your draft is unchanged.',
  );
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await expect(page.locator('#download-pdf')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#document-title')).toHaveValue('Keep this title');
  await expect(page.locator('#section-input-summary-outcome')).toHaveValue(
    'Keep this section after the failed export.',
  );

  await page.unroute('**/*.woff');
  const { download: retry } = await clickDownload(page, '#download-pdf');
  expect(retry.suggestedFilename()).toBe('keep-this-title.pdf');
  expect((await bytesFrom(retry)).subarray(0, 5)).toEqual(Buffer.from('%PDF-'));
});
