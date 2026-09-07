import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type Page,
  type Request,
} from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import {
  READER_TEXT_SIZE_STORAGE_KEY,
  type ReaderTextSizePreference,
} from '../../src/lib/reader-text-size';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import { THEME_STORAGE_KEY } from '../../src/lib/theme';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const ORIGIN = `http://localhost:${Number(process.env.PREVIEW_PORT ?? 4411)}`;
const control = (page: Page) =>
  page.locator('select[data-reader-text-size-control]');
const themeControl = (page: Page) =>
  page.locator('select[data-theme-control]');
const rootFontSize = (page: Page) =>
  page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );

declare global {
  interface Window {
    __readerTextSizeAtFirstFrame?: number;
    __readerTextSizeWrites?: string[];
    __readerTextSizeClipboardWrites?: string[];
  }
}

const downloadBytes = async (page: Page, selector: string) => {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await pending;
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const outputBytes = async (page: Page) => {
  const entries: [string, Buffer][] = [];
  for (const selector of [
    '#download-backup',
    '#download-md',
    '#download-docx',
    '#download-pdf',
  ]) {
    entries.push([selector, await downloadBytes(page, selector)]);
  }
  return Object.fromEntries(entries) as Record<string, Buffer>;
};

const editorSnapshot = (page: Page) =>
  page.evaluate(
    ({ draftKey, themeKey }) => {
      const conflict = document.querySelector<HTMLElement>('#draft-conflict');
      return {
        fields: Array.from(
          document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            '#prd-editor-form input, #prd-editor-form textarea',
          ),
          (field) => ({
            id: field.id,
            value: field.value,
            checked: field instanceof HTMLInputElement ? field.checked : undefined,
            disabled: field.disabled,
          }),
        ),
        progress: document.querySelector('#completion-count')?.textContent,
        outline: Array.from(
          document.querySelectorAll<HTMLElement>('.editor-outline a'),
          (link) => ({
            target: link.dataset.outlineTarget,
            complete: link.hasAttribute('data-outline-complete'),
          }),
        ),
        conflict: {
          hidden: conflict?.hidden,
          text: conflict?.textContent,
        },
        statuses: Array.from(
          document.querySelectorAll<HTMLElement>('.editor-status'),
          (status) => ({
            id: status.id,
            state: status.dataset.state,
            text: status.textContent,
          }),
        ),
        draft: localStorage.getItem(draftKey),
        theme: localStorage.getItem(themeKey),
        themeAttribute: document.documentElement.dataset.theme,
        clipboard: [...(window.__readerTextSizeClipboardWrites ?? [])],
        url: location.href,
        historyLength: history.length,
        scrollX: scrollX,
        scrollY: scrollY,
      };
    },
    { draftKey: PRD_EDITOR_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
  );

test('every page has one progressive Text size select with exactly two choices', async ({
  page,
}) => {
  for (const path of [
    '/',
    '/create/',
    '/guide/',
    '/history/',
    '/history/3/',
    '/sample/',
    '/template/',
    '/walkthrough/',
    '/nope/',
  ]) {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(path === '/nope/' ? 404 : 200);
    await expect(control(page), `${path} text-size control`).toHaveCount(1);
    await expect(control(page), `${path} accessible name`).toHaveAccessibleName(
      'Text size',
    );
    expect(
      await control(page)
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => ({
            text: option.textContent,
            value: (option as HTMLOptionElement).value,
          })),
        ),
      `${path} text-size choices`,
    ).toEqual([
      { text: 'Default', value: 'default' },
      { text: 'Large', value: 'large' },
    ]);
  }
});

test('fresh and invalid stored bytes remain Default without replacement writes', async ({
  browser,
}) => {
  for (const initial of [null, '20', 'Large', '\u0000invalid'] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(
      ({ key, initial }) => {
        if (initial !== null) localStorage.setItem(key, initial);
        const writes: string[] = [];
        window.__readerTextSizeWrites = writes;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (storageKey, value) {
          if (this === localStorage && storageKey === key) writes.push(value);
          return setItem.call(this, storageKey, value);
        };
      },
      { key: READER_TEXT_SIZE_STORAGE_KEY, initial },
    );

    await page.goto(`${ORIGIN}${to('/guide/')}`);
    await expect(control(page)).toHaveValue('default');
    await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
    expect(await rootFontSize(page)).toBe(17);
    expect(await page.evaluate(() => window.__readerTextSizeWrites)).toEqual([]);
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        READER_TEXT_SIZE_STORAGE_KEY,
      ),
    ).toBe(initial);
    await context.close();
  }
});

test('saved Large applies before the first frame and both choices persist exactly', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'large');
    requestAnimationFrame(() => {
      window.__readerTextSizeAtFirstFrame = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
    });
  }, READER_TEXT_SIZE_STORAGE_KEY);

  await page.goto(`${ORIGIN}${to('/guide/')}`);
  await expect(control(page)).toHaveValue('large');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  expect(await rootFontSize(page)).toBe(20);
  expect(await page.evaluate(() => window.__readerTextSizeAtFirstFrame)).toBe(20);

  await control(page).selectOption('default');
  await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
  expect(await rootFontSize(page)).toBe(17);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      READER_TEXT_SIZE_STORAGE_KEY,
    ),
  ).toBe('default');

  await control(page).selectOption('large');
  expect(await rootFontSize(page)).toBe(20);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      READER_TEXT_SIZE_STORAGE_KEY,
    ),
  ).toBe('large');

  await page.getByRole('link', { name: 'Example', exact: true }).click();
  await expect(control(page)).toHaveValue('large');
  expect(await rootFontSize(page)).toBe(20);
  expect(await page.evaluate(() => window.__readerTextSizeAtFirstFrame)).toBe(20);

  await page.reload();
  await expect(control(page)).toHaveValue('large');
  expect(await rootFontSize(page)).toBe(20);
  expect(await page.evaluate(() => window.__readerTextSizeAtFirstFrame)).toBe(20);

  const sibling = await context.newPage();
  await sibling.addInitScript(() => {
    requestAnimationFrame(() => {
      window.__readerTextSizeAtFirstFrame = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
    });
  });
  await sibling.goto(`${ORIGIN}${to('/history/')}`);
  await expect(control(sibling)).toHaveValue('large');
  expect(await rootFontSize(sibling)).toBe(20);
  expect(await sibling.evaluate(() => window.__readerTextSizeAtFirstFrame)).toBe(20);
  await context.close();
});

test('theme and text-size choices persist independently', async ({ page }) => {
  await page.goto(to('/guide/'));

  await control(page).selectOption('large');
  await themeControl(page).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await themeControl(page).selectOption('light');
  await expect(control(page)).toHaveValue('large');
  expect(await rootFontSize(page)).toBe(20);
  expect(
    await page.evaluate(
      ({ sizeKey, themeKey }) => ({
        size: localStorage.getItem(sizeKey),
        theme: localStorage.getItem(themeKey),
      }),
      {
        sizeKey: READER_TEXT_SIZE_STORAGE_KEY,
        themeKey: THEME_STORAGE_KEY,
      },
    ),
  ).toEqual({ size: 'large', theme: 'light' });

  await control(page).selectOption('default');
  await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(
    await page.evaluate(
      ({ sizeKey, themeKey }) => ({
        size: localStorage.getItem(sizeKey),
        theme: localStorage.getItem(themeKey),
      }),
      {
        sizeKey: READER_TEXT_SIZE_STORAGE_KEY,
        themeKey: THEME_STORAGE_KEY,
      },
    ),
  ).toEqual({ size: 'default', theme: 'light' });
});

test('storage exceptions are contained while current-page choices still apply', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    });
  });

  await page.goto(to('/guide/'));
  await expect(control(page)).toHaveValue('default');
  expect(await rootFontSize(page)).toBe(17);

  await control(page).selectOption('large');
  await expect(page.locator('html')).toHaveAttribute('data-text-size', 'large');
  expect(await rootFontSize(page)).toBe(20);

  await control(page).selectOption('default');
  await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
  expect(await rootFontSize(page)).toBe(17);
  expect(errors).toEqual([]);
});

test('changing text size leaves the editor, theme, browser state, clipboard, and every output byte unchanged', async ({
  page,
}) => {
  type MutableValues = {
    -readonly [Id in keyof PrdEditorState['values']]: string;
  };
  const blank = createBlankPrdEditorState();
  const values: MutableValues = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = `Reader size isolation section ${index + 1}`;
  }
  const state: PrdEditorState = {
    title: 'Reader size isolation',
    values,
  };
  const raw = JSON.stringify(
    createPrdEditorDraftPayload(state, new Date('2026-09-07T12:00:00.000Z')),
  );

  await page.addInitScript(() => {
    const NativeDate = Date;
    const fixedTimestamp = NativeDate.parse('2026-09-07T18:30:00.000Z');
    class FixedDate extends NativeDate {
      constructor(value?: string | number | Date) {
        if (value === undefined) {
          super(fixedTimestamp);
        } else {
          super(value instanceof NativeDate ? value.getTime() : value);
        }
      }

      static now() {
        return fixedTimestamp;
      }
    }
    Object.defineProperty(window, 'Date', {
      configurable: true,
      value: FixedDate,
    });
    window.__readerTextSizeClipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          window.__readerTextSizeClipboardWrites?.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto(to('/'));
  await page.evaluate(
    ({ draftKey, raw, themeKey }) => {
      localStorage.setItem(draftKey, raw);
      localStorage.setItem(themeKey, 'dark');
    },
    {
      draftKey: PRD_EDITOR_STORAGE_KEY,
      raw,
      themeKey: THEME_STORAGE_KEY,
    },
  );
  await page.reload();
  await expect(page.locator('#save-status')).toContainText('Draft restored');
  await expect(themeControl(page)).toHaveValue('dark');

  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  await expect(page.locator('#download-status')).toContainText('Copied Markdown');
  expect(
    await page.evaluate(() => window.__readerTextSizeClipboardWrites),
  ).toHaveLength(1);

  const beforeOutputs = await outputBytes(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await editorSnapshot(page);
  const requests: string[] = [];
  const requestListener = (request: Request) => requests.push(request.url());
  page.on('request', requestListener);

  await control(page).selectOption('large');
  await page.evaluate(() => Promise.resolve());
  page.off('request', requestListener);

  expect(await rootFontSize(page)).toBe(20);
  expect(await editorSnapshot(page)).toEqual(before);
  expect(requests).toEqual([]);

  const afterOutputs = await outputBytes(page);
  for (const [selector, bytes] of Object.entries(beforeOutputs)) {
    expect(
      Buffer.compare(bytes, afterOutputs[selector]!),
      `${selector} output bytes`,
    ).toBe(0);
  }
  expect(
    await page.evaluate(
      ({ draftKey, themeKey }) => ({
        draft: localStorage.getItem(draftKey),
        theme: localStorage.getItem(themeKey),
        clipboard: window.__readerTextSizeClipboardWrites,
      }),
      { draftKey: PRD_EDITOR_STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
    ),
  ).toEqual({
    draft: raw,
    theme: 'dark',
    clipboard: before.clipboard,
  });
});

test('header targets stay usable in both sizes and keyboard order is nav, Theme, Text size', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    "WebKit skips links in sequential focus navigation by default",
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const sizes: readonly ReaderTextSizePreference[] = ['default', 'large'];
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(to('/guide/'));
    for (const size of sizes) {
      await control(page).selectOption(size);
      const geometry = await page.locator('.site-header').evaluate((header) => {
        const targets = Array.from(
          header.querySelectorAll<HTMLElement>('a, select'),
          (target) => {
            const rect = target.getBoundingClientRect();
            return {
              label: target.textContent?.trim() ?? '',
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
              clipped:
                target.scrollWidth > target.clientWidth ||
                target.scrollHeight > target.clientHeight,
            };
          },
        );
        const overlaps: string[] = [];
        for (let first = 0; first < targets.length; first += 1) {
          for (let second = first + 1; second < targets.length; second += 1) {
            const a = targets[first]!;
            const b = targets[second]!;
            if (
              a.left < b.right &&
              b.left < a.right &&
              a.top < b.bottom &&
              b.top < a.bottom
            ) {
              overlaps.push(`${a.label}/${b.label}`);
            }
          }
        }
        return {
          targets,
          overlaps,
          scrollWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
        };
      });

      expect(geometry.overlaps, `${width}px ${size} overlaps`).toEqual([]);
      expect(
        {
          scrollWidth: geometry.scrollWidth,
          viewport: geometry.viewport,
        },
        `${width}px ${size} overflow`,
      ).toEqual({ scrollWidth: width, viewport: width });
      for (const target of geometry.targets) {
        expect(target.width, `${width}px ${size} ${target.label} width`).toBeGreaterThanOrEqual(32);
        expect(target.height, `${width}px ${size} ${target.label} height`).toBeGreaterThanOrEqual(32);
        expect(target.left, `${width}px ${size} ${target.label} left`).toBeGreaterThanOrEqual(0);
        expect(target.right, `${width}px ${size} ${target.label} right`).toBeLessThanOrEqual(width);
        expect(target.clipped, `${width}px ${size} ${target.label} clipped`).toBe(false);
      }
    }
  }

  await control(page).selectOption('default');
  await page.locator('.site-nav a').last().focus();
  await page.keyboard.press('Tab');
  await expect(themeControl(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(control(page)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(control(page)).toHaveValue('large');
  expect(await rootFontSize(page)).toBe(20);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(control(page)).toHaveValue('default');
  expect(await rootFontSize(page)).toBe(17);
  expect(errors).toEqual([]);
});

test('without JavaScript the original header remains and saved Large cannot override 17px', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: ORIGIN,
          localStorage: [
            { name: READER_TEXT_SIZE_STORAGE_KEY, value: 'large' },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}${to('/guide/')}`);

  await expect(page.locator('.site-header select')).toHaveCount(0);
  await expect(page.locator('.brand')).toHaveText('PRD Template');
  await expect(page.locator('.site-nav a')).toHaveText([
    'Create',
    'Example',
    'Downloads',
  ]);
  await expect(page.locator('html')).not.toHaveAttribute('data-text-size');
  expect(await rootFontSize(page)).toBe(17);
  await context.close();
});

test('print typography and palette are identical in all theme and text-size combinations', async ({
  page,
}) => {
  await page.goto(to('/guide/'));
  let baseline:
    | {
        htmlFontSize: string;
        bodyFontSize: string;
        h1FontSize: string;
        h2FontSize: string;
        color: string;
        background: string;
      }
    | undefined;

  for (const theme of ['system', 'light', 'dark'] as const) {
    for (const size of ['default', 'large'] as const) {
      await themeControl(page).selectOption(theme);
      await control(page).selectOption(size);
      await page.emulateMedia({ media: 'print', colorScheme: 'dark' });

      await expect(page.locator('.site-header')).toBeHidden();
      await expect(control(page)).toBeHidden();
      const print = await page.evaluate(() => {
        const html = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        const h1 = getComputedStyle(document.querySelector('h1')!);
        const h2 = getComputedStyle(document.querySelector('h2')!);
        return {
          htmlFontSize: html.fontSize,
          bodyFontSize: body.fontSize,
          h1FontSize: h1.fontSize,
          h2FontSize: h2.fontSize,
          color: body.color,
          background: body.backgroundColor,
        };
      });
      expect(Number.parseFloat(print.htmlFontSize)).toBeCloseTo(44 / 3, 3);
      expect(Number.parseFloat(print.bodyFontSize)).toBeCloseTo(44 / 3, 3);
      expect(print.color).toBe('rgb(0, 0, 0)');
      expect(print.background).toBe('rgb(255, 255, 255)');
      baseline ??= print;
      expect(print, `${theme}/${size} print contract`).toEqual(baseline);

      await page.emulateMedia({ media: 'screen' });
    }
  }
});
