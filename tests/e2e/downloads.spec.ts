import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';
import JSZip from 'jszip';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
} from 'pdf-lib';
import {
  exportPrdMarkdown,
  PRD_EXPORT_MIME_TYPES,
} from '../../src/lib/prd-export';
import {
  createBlankPrdEditorState,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
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

const copyFixture = (label: string): PrdEditorState => {
  const blank = createBlankPrdEditorState();
  const state = {
    title: `${label}: Café launch`,
    values: { ...blank.values },
  };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    state.values[section.id] =
      `${label} section ${index + 1}\n\n- ${section.title}\n- Distinctive value ${index + 1}`;
  }
  return state;
};

const fillDraft = async (page: Page, state: PrdEditorState) => {
  await page.locator('#document-title').fill(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await page
      .locator(`#section-input-${section.id}`)
      .fill(state.values[section.id]);
  }
};

const currentFields = (page: Page) =>
  page
    .locator('#prd-editor-form input, #prd-editor-form textarea')
    .evaluateAll((fields) =>
      fields.map((field) => (field as HTMLInputElement).value),
    );

const storedDraft = (page: Page) =>
  page.evaluate(
    (key) => localStorage.getItem(key),
    PRD_EDITOR_STORAGE_KEY,
  );

const decodeMarkdown = (bytes: Uint8Array | Buffer) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);

const canonicalMarkdown = (state: PrdEditorState) =>
  decodeMarkdown(exportPrdMarkdown(state));

const normalizePlatformNewlines = (value: string) =>
  value.replace(/\r\n/g, '\n');

const installClipboardStub = (target: Page | BrowserContext) =>
  target.addInitScript(() => {
    const testWindow = window as typeof window & {
      __prdClipboardWrites: string[];
    };
    testWindow.__prdClipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          testWindow.__prdClipboardWrites.push(text);
          return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        },
      },
    });
  });

const clipboardWrites = (page: Page) =>
  page.evaluate(
    () =>
      (window as typeof window & { __prdClipboardWrites: string[] })
        .__prdClipboardWrites,
  );

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

test('both editor routes expose one Copy Markdown action and exactly three document downloads', async ({
  page,
}) => {
  for (const path of ['/prd/', '/prd/create/']) {
    await page.goto(path);
    await expect(
      page.getByRole('button', { name: 'Copy Markdown', exact: true }),
      path,
    ).toHaveCount(1);
    await expect(page.locator('[data-export-format]'), path).toHaveCount(3);
    await expect(
      page.locator('.editor-download-actions .editor-button'),
      path,
    ).toHaveCount(4);
  }
});

test('Copy Markdown by keyboard uses the live unsaved draft and matches the canonical serializer and Markdown download', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Native clipboard reads are Chromium-only.');

  await page.goto(CREATE_PATH);
  const savedState = copyFixture('Native clipboard');
  await fillDraft(page, savedState);
  await page.locator('#save-draft').click();
  const savedBeforeLastEdit = await storedDraft(page);

  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const lastSection = PRD_TEMPLATE_SECTIONS.at(-1)!;
  const state: PrdEditorState = {
    title: savedState.title,
    values: {
      ...savedState.values,
      [lastSection.id]:
        `${savedState.values[lastSection.id]}\nUNSAVED LAST-MOMENT EDIT`,
    },
  };
  await page
    .locator(`#section-input-${lastSection.id}`)
    .fill(state.values[lastSection.id]);
  expect(await storedDraft(page)).toBe(savedBeforeLastEdit);

  const copy = page.getByRole('button', {
    name: 'Copy Markdown',
    exact: true,
  });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#download-status')).toHaveText(
    'Copied Markdown to the clipboard.',
  );
  await expect(copy).toBeEnabled();
  await expect(copy).not.toHaveAttribute('aria-busy');
  await expect(copy).toHaveAccessibleName('Copy Markdown');
  expect(await storedDraft(page)).toBe(savedBeforeLastEdit);

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const expected = canonicalMarkdown(state);
  const { download } = await clickDownload(page, '#download-md');
  const downloaded = decodeMarkdown(await bytesFrom(download));
  expect(normalizePlatformNewlines(copied)).toBe(
    normalizePlatformNewlines(expected),
  );
  expect(normalizePlatformNewlines(downloaded)).toBe(
    normalizePlatformNewlines(expected),
  );
  expect(normalizePlatformNewlines(copied)).toBe(
    normalizePlatformNewlines(downloaded),
  );
  expect(
    Array.from(expected.matchAll(/^# (.+)$/gm), (match) => match[1]),
  ).toEqual([state.title]);
  expect(
    Array.from(expected.matchAll(/^## (.+)$/gm), (match) => match[1]),
  ).toEqual(sectionTitles);
});

test('stubbed clipboard copy succeeds twice through the existing live region without changing its accessible name', async ({
  page,
}) => {
  await installClipboardStub(page);
  await page.goto(CREATE_PATH);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __prdDownloadStatusMessages: string[];
    };
    testWindow.__prdDownloadStatusMessages = [];
    const status = document.querySelector('#download-status')!;
    new MutationObserver(() => {
      testWindow.__prdDownloadStatusMessages.push(status.textContent ?? '');
    }).observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const liveRegions = page.locator(
    '[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(liveRegions).toHaveCount(2);

  const first = copyFixture('First copy');
  const second = copyFixture('Second copy');
  const copy = page.getByRole('button', {
    name: 'Copy Markdown',
    exact: true,
  });
  for (const state of [first, second]) {
    await fillDraft(page, state);
    await copy.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#download-status')).toHaveText(
      'Copied Markdown to the clipboard.',
    );
    await expect(copy).toBeEnabled();
    await expect(copy).not.toHaveAttribute('aria-busy');
    await expect(copy).toHaveAccessibleName('Copy Markdown');
  }

  expect((await clipboardWrites(page)).map(normalizePlatformNewlines)).toEqual([
    normalizePlatformNewlines(canonicalMarkdown(first)),
    normalizePlatformNewlines(canonicalMarkdown(second)),
  ]);
  const statusMessages = await page.evaluate(
    () =>
      (window as typeof window & {
        __prdDownloadStatusMessages: string[];
      }).__prdDownloadStatusMessages,
  );
  expect(statusMessages.filter((message) => message === '')).toHaveLength(2);
  expect(
    statusMessages.filter(
      (message) => message === 'Copied Markdown to the clipboard.',
    ),
  ).toHaveLength(2);
});

for (const failure of [
  {
    name: 'unavailable',
    message:
      'Clipboard access is unavailable. Use the Markdown (.md) download instead.',
  },
  {
    name: 'rejected write',
    message:
      'Could not copy Markdown to the clipboard. Use the Markdown (.md) download instead.',
  },
] as const) {
  test(`clipboard ${failure.name} preserves every field and the working Markdown download`, async ({
    page,
  }) => {
    await page.addInitScript((name) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: name === 'unavailable'
          ? undefined
          : {
              writeText() {
                return Promise.reject(
                  new DOMException('Clipboard denied', 'NotAllowedError'),
                );
              },
            },
      });
    }, failure.name);
    await page.goto(CREATE_PATH);
    const state = copyFixture(`Clipboard ${failure.name}`);
    await fillDraft(page, state);
    const fieldsBefore = await currentFields(page);
    const completionBefore = await page
      .locator('#completion-count')
      .textContent();

    const copy = page.getByRole('button', {
      name: 'Copy Markdown',
      exact: true,
    });
    await copy.click();
    await expect(page.locator('#download-status')).toHaveText(failure.message);
    await expect(copy).toBeEnabled();
    await expect(copy).not.toHaveAttribute('aria-busy');
    await expect(page.locator('#download-md')).toBeEnabled();
    expect(await currentFields(page)).toEqual(fieldsBefore);
    await expect(page.locator('#completion-count')).toHaveText(
      completionBefore ?? '',
    );

    const { download } = await clickDownload(page, '#download-md');
    expect(normalizePlatformNewlines(decodeMarkdown(await bytesFrom(download)))).toBe(
      normalizePlatformNewlines(canonicalMarkdown(state)),
    );
    expect(await currentFields(page)).toEqual(fieldsBefore);
  });
}

test('copy remains local and available when draft persistence is unavailable', async ({
  page,
}) => {
  await installClipboardStub(page);
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __prdStorageAccesses: number;
    };
    testWindow.__prdStorageAccesses = 0;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        testWindow.__prdStorageAccesses += 1;
        throw new DOMException('Storage disabled', 'SecurityError');
      },
    });
  });
  await page.goto(CREATE_PATH);
  const state = copyFixture('No persistence');
  await fillDraft(page, state);
  await page.waitForTimeout(450);
  const fieldsBefore = await currentFields(page);
  const completionBefore = await page.locator('#completion-count').textContent();
  const accessesBefore = await page.evaluate(
    () =>
      (window as typeof window & { __prdStorageAccesses: number })
        .__prdStorageAccesses,
  );

  const copy = page.getByRole('button', {
    name: 'Copy Markdown',
    exact: true,
  });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.locator('#download-status')).toHaveText(
    'Copied Markdown to the clipboard.',
  );
  expect(await clipboardWrites(page)).toEqual([canonicalMarkdown(state)]);
  expect(await currentFields(page)).toEqual(fieldsBefore);
  await expect(page.locator('#completion-count')).toHaveText(
    completionBefore ?? '',
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __prdStorageAccesses: number })
          .__prdStorageAccesses,
    ),
  ).toBe(accessesBefore);
});

test('copy uses this tab live values without changing saved bytes or resolving a stale-tab conflict', async ({
  context,
  page,
}) => {
  await installClipboardStub(context);
  await page.goto(CREATE_PATH);
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PRD_EDITOR_STORAGE_KEY,
  );
  await page.reload();

  await fillDraft(page, copyFixture('Original saved copy'));
  await page.locator('#save-draft').click();
  const other = await context.newPage();
  await other.goto('/prd/create/');
  await fillDraft(other, copyFixture('Newer saved copy'));
  await other.locator('#save-draft').click();
  const savedBytes = await storedDraft(other);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveAttribute(
    'data-state',
    'conflict',
  );

  const localState = copyFixture('Unsaved stale tab');
  await fillDraft(page, localState);
  const fieldsBefore = await currentFields(page);
  const completionBefore = await page.locator('#completion-count').textContent();
  expect(await storedDraft(page)).toBe(savedBytes);

  await page.getByRole('button', {
    name: 'Copy Markdown',
    exact: true,
  }).click();
  await expect(page.locator('#download-status')).toHaveText(
    'Copied Markdown to the clipboard.',
  );
  expect(await clipboardWrites(page)).toEqual([canonicalMarkdown(localState)]);
  expect(await currentFields(page)).toEqual(fieldsBefore);
  await expect(page.locator('#completion-count')).toHaveText(
    completionBefore ?? '',
  );
  expect(await storedDraft(page)).toBe(savedBytes);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveAttribute(
    'data-state',
    'conflict',
  );
  await other.close();
});

test('all current-draft actions remain at least 32px and overflow-free at supported widths', async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(CREATE_PATH);
    const actions = page.locator(
      '.editor-download-actions .editor-button:visible',
    );
    await expect(actions).toHaveCount(4);
    const boxes = await actions.evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return {
          name: button.textContent?.trim(),
          height: box.height,
          width: box.width,
          left: box.left,
          right: box.right,
        };
      }),
    );
    for (const box of boxes) {
      expect(box.height, `${box.name} height at ${width}px`).toBeGreaterThanOrEqual(32);
      expect(box.width, `${box.name} width at ${width}px`).toBeGreaterThanOrEqual(32);
      expect(box.left, `${box.name} left edge at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${box.name} right edge at ${width}px`).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      })),
    ).toEqual({ scrollWidth: width, clientWidth: width });
  }
});
