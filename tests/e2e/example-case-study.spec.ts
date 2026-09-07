import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import JSZip from 'jszip';
import {
  EXAMPLE_CASE_STUDY_FILENAME,
  EXAMPLE_CASE_STUDY_FILES,
  EXAMPLE_CASE_STUDY_MIME,
  EXAMPLE_CASE_STUDY_PATH,
} from '../../src/lib/example-case-study';
import { CURRENT_EXAMPLE_MARKDOWN_PATH } from '../../src/lib/example-markdown-download';
import { HISTORY_INDEX_DOWNLOAD } from '../../src/lib/history-index-download';
import { WALKTHROUGH_DOWNLOAD_PATH } from '../../src/lib/walkthrough-download';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const SAMPLE_PATH = to('/sample/');
const BUNDLE_PATH = to(EXAMPLE_CASE_STUDY_PATH);
const BUNDLE_LABEL = 'Download case study (.zip)';
const DESCRIPTION =
  'Includes the current PRD, Walkthrough, and revision index.';
const standalonePaths = {
  'build-the-urlist.md': CURRENT_EXAMPLE_MARKDOWN_PATH,
  'prd-example-walkthrough.md': WALKTHROUGH_DOWNLOAD_PATH,
  'prd-revision-history.md': HISTORY_INDEX_DOWNLOAD.path,
} as const;

const downloadBytes = async (download: Download): Promise<Buffer> => {
  expect(download.suggestedFilename()).toBe(EXAMPLE_CASE_STUDY_FILENAME);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('Example case-study download has no temporary path.');
  return readFile(path);
};

const clickBundle = async (page: Page): Promise<Download> => {
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: BUNDLE_LABEL }).click();
  return pending;
};

test('case-study route and no-script native retry return the exact three standalone resources', async ({
  browser,
  request,
}) => {
  const response = await request.get(BUNDLE_PATH);
  const routeBytes = await response.body();
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe(EXAMPLE_CASE_STUDY_MIME);
  expect(routeBytes.byteLength).toBeGreaterThan(0);

  const context = await browser.newContext({
    acceptDownloads: true,
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    await page.goto(SAMPLE_PATH);
    const action = page.getByRole('link', { name: BUNDLE_LABEL });
    await expect(action).toHaveCount(1);
    await expect(action).toHaveAttribute('href', BUNDLE_PATH);
    await expect(action).toHaveAttribute(
      'download',
      EXAMPLE_CASE_STUDY_FILENAME,
    );
    await expect(page.locator('.source-card__case-study')).toHaveText(
      DESCRIPTION,
    );

    const pageUrl = page.url();
    const firstBytes = await downloadBytes(await clickBundle(page));
    const secondBytes = await downloadBytes(await clickBundle(page));
    expect(page.url()).toBe(pageUrl);
    expect(firstBytes).toEqual(routeBytes);
    expect(secondBytes).toEqual(firstBytes);

    const zip = await JSZip.loadAsync(firstBytes, { checkCRC32: true });
    const expectedNames = EXAMPLE_CASE_STUDY_FILES.map(
      ({ filename }) => filename,
    );
    expect(Object.keys(zip.files)).toEqual(expectedNames);
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);
    for (const filename of expectedNames) {
      const standalone = await request.get(to(standalonePaths[filename]));
      expect(standalone.status(), filename).toBe(200);
      expect(await zip.file(filename)?.async('nodebuffer'), filename).toEqual(
        await standalone.body(),
      );
    }
  } finally {
    await context.close();
  }
});

test('Example owns the only server-rendered case-study action with or without Clipboard', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(SAMPLE_PATH);
  expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined();
  await expect(page.getByRole('link', { name: BUNDLE_LABEL })).toHaveCount(1);
  await expect(page.locator('.source-card__case-study')).toHaveText(DESCRIPTION);

  for (const path of [
    '/',
    '/create/',
    '/guide/',
    '/walkthrough/',
    '/template/',
    '/history/',
    '/history/3/',
  ]) {
    await page.goto(to(path));
    await expect(page.locator(`a[href="${BUNDLE_PATH}"]`), path).toHaveCount(0);
    await expect(page.locator('.source-card__case-study'), path).toHaveCount(0);
  }
});

test('case-study download is independent from page state, APIs, and existing actions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __caseStudyActivity: {
        clipboard: number;
        storageReads: number;
        storageWrites: number;
        history: number;
        print: number;
      };
    };
    const activity = {
      clipboard: 0,
      storageReads: 0,
      storageWrites: 0,
      history: 0,
      print: 0,
    };
    testWindow.__caseStudyActivity = activity;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText() {
          activity.clipboard += 1;
          return Promise.resolve();
        },
      },
    });
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      activity.storageReads += 1;
      return getItem.call(this, key);
    };
    const key = Storage.prototype.key;
    Storage.prototype.key = function (index) {
      activity.storageReads += 1;
      return key.call(this, index);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      activity.storageWrites += 1;
      return setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      activity.storageWrites += 1;
      return removeItem.call(this, key);
    };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      activity.storageWrites += 1;
      return clear.call(this);
    };
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        activity.history += 1;
        return original(...args);
      };
    }
    window.print = () => {
      activity.print += 1;
    };
  });

  const externalRequests: string[] = [];
  const requestsWithBodies: string[] = [];
  const mainFrameNavigations: string[] = [];
  const failedRequests: string[] = [];
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto(SAMPLE_PATH);
  const origin = new URL(page.url()).origin;
  const originalUrl = page.url();
  const originalHistoryLength = await page.evaluate(() => history.length);
  const originalState = await page.evaluate(() => ({
    local: Object.entries(localStorage).sort(),
    session: Object.entries(sessionStorage).sort(),
  }));
  await page.evaluate(() => {
    const activity = (
      window as typeof window & {
        __caseStudyActivity: Record<string, number>;
      }
    ).__caseStudyActivity;
    for (const key of Object.keys(activity)) activity[key] = 0;
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== origin) {
      externalRequests.push(request.url());
    }
    if (request.postData() !== null) requestsWithBodies.push(request.url());
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations.push(frame.url());
  });

  const first = await downloadBytes(await clickBundle(page));
  const second = await downloadBytes(await clickBundle(page));
  expect(first).toEqual(second);
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => history.length)).toBe(originalHistoryLength);
  expect(
    await page.evaluate(() => ({
      local: Object.entries(localStorage).sort(),
      session: Object.entries(sessionStorage).sort(),
    })),
  ).toEqual(originalState);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __caseStudyActivity: Record<string, number>;
          }
        ).__caseStudyActivity,
    ),
  ).toEqual({
    clipboard: 0,
    storageReads: 0,
    storageWrites: 0,
    history: 0,
    print: 0,
  });
  expect(externalRequests).toEqual([]);
  expect(requestsWithBodies).toEqual([]);
  expect(mainFrameNavigations).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);

  await expect(page.getByRole('link', { name: 'Download .md' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Word (.docx)' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'PDF', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Copy the PRD' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Revision history' })).toHaveCount(1);
});

test('case-study action remains usable in every presentation and is absent from print', async ({
  page,
}) => {
  await page.goto(SAMPLE_PATH);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      for (const size of ['default', 'large'] as const) {
        await page.locator('html').evaluate(
          (root, setting) => {
            root.dataset.theme = setting.theme;
            if (setting.size === 'large') root.dataset.textSize = 'large';
            else delete root.dataset.textSize;
          },
          { theme, size },
        );
        const action = page.getByRole('link', { name: BUNDLE_LABEL });
        await action.scrollIntoViewIfNeeded();
        const geometry = await action.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const siblings = Array.from(
            node.closest('ul')?.querySelectorAll('a, button') ?? [],
          )
            .filter((sibling) => sibling !== node)
            .map((sibling) => sibling.getBoundingClientRect());
          return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            clipped:
              node.scrollWidth > node.clientWidth ||
              node.scrollHeight > node.clientHeight,
            overlaps: siblings.some(
              (sibling) =>
                rect.left < sibling.right &&
                sibling.left < rect.right &&
                rect.top < sibling.bottom &&
                sibling.top < rect.bottom,
            ),
            pageWidth: document.documentElement.scrollWidth,
          };
        });
        const label = `${width}px ${theme}/${size}`;
        expect(geometry.width, label).toBeGreaterThanOrEqual(32);
        expect(geometry.height, label).toBeGreaterThanOrEqual(32);
        expect(geometry.left, label).toBeGreaterThanOrEqual(0);
        expect(geometry.right, label).toBeLessThanOrEqual(width);
        expect(geometry.top, label).toBeGreaterThanOrEqual(0);
        expect(geometry.bottom, label).toBeLessThanOrEqual(900);
        expect(geometry.clipped, label).toBe(false);
        expect(geometry.overlaps, label).toBe(false);
        expect(geometry.pageWidth, label).toBe(width);
      }
    }
  }

  const pdf = page.getByRole('link', { name: 'PDF', exact: true });
  await pdf.focus();
  await page.keyboard.press('Tab');
  const action = page.getByRole('link', { name: BUNDLE_LABEL });
  await expect(action).toBeFocused();
  const focus = await action.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).not.toBe('0px');

  const headings = await page
    .locator('.doc__body h1, .doc__body h2, .doc__body h3, .doc__body h4')
    .allTextContents();
  await page.emulateMedia({ media: 'print' });
  await expect(action).toBeHidden();
  await expect(page.locator('.source-card__case-study')).toBeHidden();
  expect(
    await page
      .locator('.doc__body h1, .doc__body h2, .doc__body h3, .doc__body h4')
      .allTextContents(),
  ).toEqual(headings);
});
