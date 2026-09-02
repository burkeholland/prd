import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const CREATE_PATH = '/prd/create/';
const SENTINEL = 'PRIVATE-DRAFT-SENTINEL-8251';

const bytesFrom = async (download: Download): Promise<Buffer> => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const clickDownload = async (page: Page, id: string) => {
  const pending = page.waitForEvent('download');
  await page.locator(id).click();
  return pending;
};

test('all three stable blank-template URLs return real files with the right MIME types', async ({
  request,
}) => {
  const files = [
    {
      path: '/prd/downloads/prd-template.md',
      type: 'text/markdown',
      signature: Buffer.from('# Product requirements document'),
    },
    {
      path: '/prd/downloads/prd-template.docx',
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    },
    {
      path: '/prd/downloads/prd-template.pdf',
      type: 'application/pdf',
      signature: Buffer.from('%PDF-'),
    },
  ] as const;

  for (const file of files) {
    const response = await request.get(file.path);
    const body = await response.body();
    expect(response.status(), file.path).toBe(200);
    expect(response.headers()['content-type'], file.path).toContain(file.type);
    expect(body.byteLength, file.path).toBeGreaterThan(0);
    expect(body.subarray(0, file.signature.length), file.path).toEqual(file.signature);

    if (file.path.endsWith('.md')) {
      const markdown = new TextDecoder('utf-8', { fatal: true }).decode(body);
      expect(markdown.match(/^# /gm)).toHaveLength(1);
      expect(markdown.match(/^## /gm)).toHaveLength(12);
    }
  }
});

test('current draft downloads as Markdown, Word, and PDF with sanitized names and no draft network payload', async ({
  page,
}) => {
  await page.goto(CREATE_PATH);
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });

  await page.locator('#document-title').fill('Launch: Café / Q4 2026?');
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await page
      .locator(`#section-input-${section.id}`)
      .fill(
        index === 0
          ? `${SENTINEL}: “Café” — 50% & rising.\nSecond line stays.\n\n- First item\n- Deuxième item\n1. Ordered item`
          : `${SENTINEL} decision ${index + 1}.`,
      );
  }

  const markdownDownload = await clickDownload(page, '#download-md');
  expect(markdownDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.md');
  const markdownBytes = await bytesFrom(markdownDownload);
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(markdownBytes);
  expect(markdown).toContain(`${SENTINEL}: “Café” — 50% & rising.`);
  expect(markdown).toContain('Second line stays.\n\n- First item\n- Deuxième item');
  expect(markdown.match(/^# /gm)).toHaveLength(1);
  expect(markdown.match(/^## /gm)).toHaveLength(12);

  const wordDownload = await clickDownload(page, '#download-docx');
  expect(wordDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.docx');
  const wordBytes = await bytesFrom(wordDownload);
  expect(wordBytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  const pdfDownload = await clickDownload(page, '#download-pdf');
  expect(pdfDownload.suggestedFilename()).toBe('launch-cafe-q4-2026.pdf');
  const pdfBytes = await bytesFrom(pdfDownload);
  expect(pdfBytes.subarray(0, 5)).toEqual(Buffer.from('%PDF-'));

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
});
