import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type Download,
  type Locator,
} from '@playwright/test';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import { parseExamplePrdMarkdown } from '../../src/lib/example-prd';
import { PRD_EDITOR_STORAGE_KEY } from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const BASE = '/prd';
const SAMPLE_PATH = `${BASE}/sample/`;
const DOWNLOADS = [
  {
    label: 'Word (.docx)',
    path: `${BASE}/downloads/build-the-urlist.docx`,
    filename: 'build-the-urlist.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  },
  {
    label: 'PDF',
    path: `${BASE}/downloads/build-the-urlist.pdf`,
    filename: 'build-the-urlist.pdf',
    type: 'application/pdf',
    signature: Buffer.from('%PDF-'),
  },
] as const;
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

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const pdfText = async (bytes: Buffer): Promise<string> => {
  const loading = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
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

const xmlText = (xml: string): string =>
  xml
    .replace(/<w:br\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const docxHeadings = (documentXml: string, style: 'Heading1' | 'Heading2') =>
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

const representativeText = (body: string): string => {
  const line = body
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value && !value.startsWith('#'));
  if (!line) throw new Error('Expected every Example section to have body text.');
  return line.slice(0, 48);
};

const compact = (value: string): string => value.replace(/\s+/gu, '');

const rectangles = (locator: Locator) =>
  locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.textContent?.trim() ?? '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        clipped:
          node.scrollWidth > node.clientWidth ||
          node.scrollHeight > node.clientHeight,
      };
    }),
  );

const intersects = (
  first: Awaited<ReturnType<typeof rectangles>>[number],
  second: Awaited<ReturnType<typeof rectangles>>[number],
) =>
  first.left < second.right &&
  second.left < first.right &&
  first.top < second.bottom &&
  second.top < first.bottom;

test('Example exposes exactly one same-origin Markdown, Word, and PDF link with or without JavaScript', async ({
  browser,
  page,
  request,
}) => {
  await page.goto(SAMPLE_PATH);
  const formatLinks = page.locator('.source-card__links a[download]');
  await expect(formatLinks).toHaveText([
    'Download .md',
    'Word (.docx)',
    'PDF',
    'Download case study (.zip)',
  ]);
  expect(
    await formatLinks.evaluateAll((links) =>
      links.map((link) => ({
        href: link.getAttribute('href'),
        download: link.getAttribute('download'),
      })),
    ),
  ).toEqual([
    {
      href: `${BASE}/raw/build-the-urlist.md`,
      download: 'build-the-urlist.md',
    },
    {
      href: DOWNLOADS[0].path,
      download: DOWNLOADS[0].filename,
    },
    {
      href: DOWNLOADS[1].path,
      download: DOWNLOADS[1].filename,
    },
    {
      href: `${BASE}/downloads/prd-example-case-study.zip`,
      download: 'prd-example-case-study.zip',
    },
  ]);

  for (const file of DOWNLOADS) {
    const response = await request.get(file.path);
    expect(response.status(), file.path).toBe(200);
    expect(response.headers()['content-type'], file.path).toBe(file.type);
    expect((await response.body()).subarray(0, file.signature.length)).toEqual(
      file.signature,
    );
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await context.newPage();
  await noScriptPage.goto(SAMPLE_PATH);
  await expect(noScriptPage.locator('.source-card__links a')).toHaveText([
    'View original',
    'Download .md',
    'Word (.docx)',
    'PDF',
    'Download case study (.zip)',
    'Revision history',
  ]);
  await expect(noScriptPage.locator('.source-card__links a[download]')).toHaveCount(4);
  await expect(noScriptPage.getByRole('link', { name: 'View original' })).toHaveCount(1);
  await expect(noScriptPage.getByRole('link', { name: 'Revision history' })).toHaveAttribute(
    'href',
    `${BASE}/history/`,
  );
  await expect(noScriptPage.locator('button.copy-prd')).toHaveCount(0);
  await context.close();
});

test('Example Word and PDF anchors perform native downloads without changing page state', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'real generated downloads are covered in Chromium');
  await page.addInitScript(
    ({ draftKey }) => {
      localStorage.setItem(draftKey, 'PRIVATE-EXAMPLE-DRAFT');
      const testWindow = window as typeof window & {
        __clipboardWrites: string[];
        __historyCalls: string[];
      };
      testWindow.__clipboardWrites = [];
      testWindow.__historyCalls = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText(value: string) {
            testWindow.__clipboardWrites.push(value);
            return Promise.resolve();
          },
        },
      });
      for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method].bind(history);
        history[method] = (...args) => {
          testWindow.__historyCalls.push(method);
          return original(...args);
        };
      }
    },
    { draftKey: PRD_EDITOR_STORAGE_KEY },
  );
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const runtimeRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto(SAMPLE_PATH);
  const originalUrl = page.url();
  const origin = new URL(originalUrl).origin;
  const originalHistoryLength = await page.evaluate(() => history.length);
  page.on('request', (request) => runtimeRequests.push(request.url()));
  const source = await readFile(
    resolve('content/gist/build-the-urlist.md'),
    'utf8',
  );
  const document = parseExamplePrdMarkdown(source);
  expect(document.sections.map(({ title }) => title)).toEqual(
    SOURCE_SECTION_TITLES,
  );

  for (const file of DOWNLOADS) {
    const pending = page.waitForEvent('download');
    await page.getByRole('link', { name: file.label, exact: true }).click();
    const download = await pending;
    const bytes = await downloadBytes(download);
    expect(download.suggestedFilename()).toBe(file.filename);
    expect(download.url()).toBe(`${origin}${file.path}`);
    expect(bytes.subarray(0, file.signature.length)).toEqual(file.signature);

    if (file.filename.endsWith('.docx')) {
      const zip = await JSZip.loadAsync(bytes);
      const xml = await zip.file('word/document.xml')!.async('text');
      expect(docxHeadings(xml, 'Heading1')).toEqual([document.title]);
      expect(docxHeadings(xml, 'Heading2')).toEqual(SOURCE_SECTION_TITLES);
      const text = compact(xmlText(xml));
      expect(text).toContain(compact(document.preamble ?? ''));
      for (const section of document.sections) {
        expect(text, section.title).toContain(
          compact(representativeText(section.body)),
        );
      }
    } else {
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(pdf.getTitle()).toBe(document.title);
      expect(pdfOutlineTitles(pdf)).toEqual([
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
    }
  }

  expect(runtimeRequests).toEqual([]);
  expect(
    await page.evaluate(
      (draftKey) => ({
        draft: localStorage.getItem(draftKey),
        clipboard: (window as typeof window & { __clipboardWrites: string[] })
          .__clipboardWrites,
        historyCalls: (window as typeof window & { __historyCalls: string[] })
          .__historyCalls,
        historyLength: history.length,
      }),
      PRD_EDITOR_STORAGE_KEY,
    ),
  ).toEqual({
    draft: 'PRIVATE-EXAMPLE-DRAFT',
    clipboard: [],
    historyCalls: [],
    historyLength: originalHistoryLength,
  });
  expect(page.url()).toBe(originalUrl);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('all Example source-card actions wrap as usable targets in every supported presentation', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(SAMPLE_PATH);
    for (const theme of ['light', 'dark'] as const) {
      for (const size of ['default', 'large'] as const) {
        await page.locator('html').evaluate(
          (root, presentation) => {
            root.dataset.theme = presentation.theme;
            if (presentation.size === 'large') root.dataset.textSize = 'large';
            else delete root.dataset.textSize;
          },
          { theme, size },
        );
        await page.locator('.source-card').scrollIntoViewIfNeeded();
        const actions = await rectangles(
          page.locator('.source-card__links a, .source-card__links button'),
        );
        expect(actions.map(({ label }) => label)).toEqual([
          'View original',
          'Download .md',
          'Copy the PRD',
          'Word (.docx)',
          'PDF',
          'Download case study (.zip)',
          'Revision history',
        ]);
        for (const action of actions) {
          expect(action.width, `${width}px ${theme} ${size} ${action.label} width`).toBeGreaterThanOrEqual(32);
          expect(action.height, `${width}px ${theme} ${size} ${action.label} height`).toBeGreaterThanOrEqual(32);
          expect(action.left, `${width}px ${theme} ${size} ${action.label} left`).toBeGreaterThanOrEqual(0);
          expect(action.right, `${width}px ${theme} ${size} ${action.label} right`).toBeLessThanOrEqual(width);
          expect(action.top, `${width}px ${theme} ${size} ${action.label} top`).toBeGreaterThanOrEqual(0);
          expect(action.bottom, `${width}px ${theme} ${size} ${action.label} bottom`).toBeLessThanOrEqual(900);
          expect(action.clipped, `${width}px ${theme} ${size} ${action.label} clipped`).toBe(false);
        }
        for (let first = 0; first < actions.length; first += 1) {
          for (let second = first + 1; second < actions.length; second += 1) {
            expect(
              intersects(actions[first]!, actions[second]!),
              `${width}px ${theme} ${size} ${actions[first]!.label}/${actions[second]!.label}`,
            ).toBe(false);
          }
        }
        expect(
          await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
          })),
        ).toEqual({ scrollWidth: width, viewport: width });
      }
    }
  }
  expect(errors).toEqual([]);
});

test('print hides Example actions without changing its document headings', async ({
  page,
}) => {
  await page.goto(SAMPLE_PATH);
  const headings = await page
    .locator('.doc__body h1, .doc__body h2, .doc__body h3, .doc__body h4')
    .allTextContents();
  expect(headings.length).toBeGreaterThan(PRD_TEMPLATE_SECTIONS.length);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.source-card__links:visible')).toHaveCount(0);
  expect(
    await page
      .locator('.doc__body h1, .doc__body h2, .doc__body h3, .doc__body h4')
      .allTextContents(),
  ).toEqual(headings);
});
