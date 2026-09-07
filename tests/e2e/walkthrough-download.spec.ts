import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { parseFrontmatter } from '../../scripts/lib/content.mjs';
import { PRD_EDITOR_STORAGE_KEY } from '../../src/lib/prd-editor-state';
import {
  createWalkthroughMarkdownResponse,
  WALKTHROUGH_DOWNLOAD_FILENAME,
  WALKTHROUGH_DOWNLOAD_PATH,
  WALKTHROUGH_MARKDOWN_MIME,
  type WalkthroughDownloadEntry,
} from '../../src/lib/walkthrough-download';

const BASE = '/prd';
const ORIGIN = `http://localhost:${Number(process.env.PREVIEW_PORT ?? 4411)}`;
const WALKTHROUGH_PATH = `${BASE}/walkthrough/`;
const DOWNLOAD_PATH = `${BASE}${WALKTHROUGH_DOWNLOAD_PATH}`;
const DOWNLOAD_LABEL = 'Download walkthrough (.md)';
const OTHER_DOC_ROUTES = ['/sample/', '/guide/', '/template/', '/history/'];

const source = readFileSync(resolve('content/walkthrough.md'), 'utf8');
const parsed = parseFrontmatter(source);
if (!parsed.data) throw new Error('walkthrough fixture requires frontmatter');
const entry: WalkthroughDownloadEntry = { data: parsed.data, body: parsed.body };

const responseBytes = async () =>
  Buffer.from(await createWalkthroughMarkdownResponse(entry).arrayBuffer());

const downloadBytes = async (download: Download) => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFileSync(path);
};

const downloadLink = (page: Page) =>
  page.getByRole('link', { name: DOWNLOAD_LABEL, exact: true });

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

test('the prerendered resource has exact metadata, source-derived bytes, and a stable retry', async ({
  request,
}) => {
  const expected = await responseBytes();
  const first = await request.get(DOWNLOAD_PATH);
  const second = await request.get(DOWNLOAD_PATH);
  const firstBytes = await first.body();
  const secondBytes = await second.body();

  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe(WALKTHROUGH_MARKDOWN_MIME);
  expect(firstBytes).toEqual(expected);
  expect(secondBytes).toEqual(firstBytes);
  expect(firstBytes.byteLength).toBeGreaterThan(0);
  expect(firstBytes.at(-1)).toBe(0x0a);
  expect(firstBytes.at(-2)).not.toBe(0x0a);
});

test('only Walkthrough exposes one server-rendered download in every capability mode', async ({
  browser,
  page,
}) => {
  await page.goto(WALKTHROUGH_PATH);
  await expect(downloadLink(page)).toHaveCount(1);
  await expect(downloadLink(page)).toHaveAttribute('href', DOWNLOAD_PATH);
  await expect(downloadLink(page)).toHaveAttribute('download', WALKTHROUGH_DOWNLOAD_FILENAME);
  await expect(page.locator('.doc__page-actions > :is(a, button)')).toHaveText([
    'Copy page link',
    DOWNLOAD_LABEL,
    'Print this page',
  ]);

  for (const route of OTHER_DOC_ROUTES) {
    await page.goto(`${BASE}${route}`);
    await expect(downloadLink(page), route).toHaveCount(0);
  }

  const noClipboard = await browser.newContext();
  const noClipboardPage = await noClipboard.newPage();
  await noClipboardPage.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });
  await noClipboardPage.goto(`${ORIGIN}${WALKTHROUGH_PATH}`);
  await expect(downloadLink(noClipboardPage)).toHaveCount(1);
  await expect(noClipboardPage.locator('.doc__page-actions > :is(a, button)')).toHaveText([
    DOWNLOAD_LABEL,
    'Print this page',
  ]);
  await noClipboard.close();

  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(`${ORIGIN}${WALKTHROUGH_PATH}`);
  await expect(downloadLink(noScriptPage)).toHaveCount(1);
  await expect(noScriptPage.locator('.doc__page-actions > :is(a, button)')).toHaveText([
    DOWNLOAD_LABEL,
  ]);
  await expect(noScriptPage.locator('.doc__body')).not.toBeEmpty();
  await noScript.close();
});

test('native download and retry are state-neutral and byte-identical to the response helper', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'real walkthrough downloads are covered in Chromium');

  await page.addInitScript(
    ({ draftKey }) => {
      localStorage.setItem(draftKey, 'PRIVATE-WALKTHROUGH-DRAFT');
      sessionStorage.setItem('private-session-state', 'PRIVATE-WALKTHROUGH-SESSION');

      const testWindow = window as typeof window & {
        __walkthroughClipboardWrites: string[];
        __walkthroughHistoryCalls: string[];
        __walkthroughStorageAccesses: number;
        __walkthroughStorageWrites: number;
        __walkthroughStorageSnapshot: () => string;
      };
      testWindow.__walkthroughClipboardWrites = [];
      testWindow.__walkthroughHistoryCalls = [];
      testWindow.__walkthroughStorageAccesses = 0;
      testWindow.__walkthroughStorageWrites = 0;

      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      const removeItem = Storage.prototype.removeItem;
      const clear = Storage.prototype.clear;
      const snapshot = () =>
        JSON.stringify({
          local: Array.from({ length: localStorage.length }, (_, index) => {
            const key = localStorage.key(index) ?? '';
            return [key, getItem.call(localStorage, key)];
          }).sort(),
          session: Array.from({ length: sessionStorage.length }, (_, index) => {
            const key = sessionStorage.key(index) ?? '';
            return [key, getItem.call(sessionStorage, key)];
          }).sort(),
        });
      testWindow.__walkthroughStorageSnapshot = snapshot;

      Storage.prototype.getItem = function (key) {
        testWindow.__walkthroughStorageAccesses += 1;
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        testWindow.__walkthroughStorageWrites += 1;
        return setItem.call(this, key, value);
      };
      Storage.prototype.removeItem = function (key) {
        testWindow.__walkthroughStorageWrites += 1;
        return removeItem.call(this, key);
      };
      Storage.prototype.clear = function () {
        testWindow.__walkthroughStorageWrites += 1;
        return clear.call(this);
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText(value: string) {
            testWindow.__walkthroughClipboardWrites.push(value);
            return Promise.resolve();
          },
        },
      });
      for (const method of ['pushState', 'replaceState'] as const) {
        const original = history[method].bind(history);
        history[method] = (...args) => {
          testWindow.__walkthroughHistoryCalls.push(method);
          return original(...args);
        };
      }
    },
    { draftKey: PRD_EDITOR_STORAGE_KEY },
  );

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto(WALKTHROUGH_PATH);
  await page.waitForLoadState('networkidle');
  const expected = await responseBytes();
  const originalUrl = page.url();
  const originalHistoryLength = await page.evaluate(() => history.length);
  const originalContent = await page.locator('.doc__body').innerHTML();
  const originalTocs = await page.locator('.toc').allInnerTexts();
  const originalStorage = await page.evaluate(
    () =>
      (window as typeof window & { __walkthroughStorageSnapshot: () => string })
        .__walkthroughStorageSnapshot(),
  );
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __walkthroughClipboardWrites: string[];
      __walkthroughHistoryCalls: string[];
      __walkthroughStorageAccesses: number;
      __walkthroughStorageWrites: number;
    };
    testWindow.__walkthroughClipboardWrites.length = 0;
    testWindow.__walkthroughHistoryCalls.length = 0;
    testWindow.__walkthroughStorageAccesses = 0;
    testWindow.__walkthroughStorageWrites = 0;
  });

  const observedRequests: { method: string; postData: string | null; url: string }[] = [];
  const navigations: string[] = [];
  page.on('request', (request) => {
    observedRequests.push({
      method: request.method(),
      postData: request.postData(),
      url: request.url(),
    });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  const downloads: Buffer[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pending = page.waitForEvent('download');
    await downloadLink(page).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(WALKTHROUGH_DOWNLOAD_FILENAME);
    expect(download.url()).toBe(`${ORIGIN}${DOWNLOAD_PATH}`);
    downloads.push(await downloadBytes(download));
  }

  expect(downloads).toEqual([expected, expected]);
  expect(page.url()).toBe(originalUrl);
  expect(await page.evaluate(() => history.length)).toBe(originalHistoryLength);
  expect(await page.locator('.doc__body').innerHTML()).toBe(originalContent);
  expect(await page.locator('.toc').allInnerTexts()).toEqual(originalTocs);
  expect(navigations).toEqual([]);
  expect(
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __walkthroughClipboardWrites: string[];
        __walkthroughHistoryCalls: string[];
        __walkthroughStorageAccesses: number;
        __walkthroughStorageWrites: number;
        __walkthroughStorageSnapshot: () => string;
      };
      return {
        clipboard: testWindow.__walkthroughClipboardWrites,
        historyCalls: testWindow.__walkthroughHistoryCalls,
        storageAccesses: testWindow.__walkthroughStorageAccesses,
        storageWrites: testWindow.__walkthroughStorageWrites,
        storage: testWindow.__walkthroughStorageSnapshot(),
      };
    }),
  ).toEqual({
    clipboard: [],
    historyCalls: [],
    storageAccesses: 0,
    storageWrites: 0,
    storage: originalStorage,
  });
  for (const request of observedRequests) {
    expect(request.method, request.url).toBe('GET');
    expect(request.postData, request.url).toBeNull();
    expect(new URL(request.url).origin, request.url).toBe(ORIGIN);
    expect(new URL(request.url).pathname, request.url).toBe(DOWNLOAD_PATH);
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('all header actions wrap as accessible targets across themes, text sizes, and widths', async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(WALKTHROUGH_PATH);

    for (const theme of ['light', 'dark']) {
      await page.locator('select[data-theme-control]').selectOption(theme);
      for (const textSize of ['default', 'large']) {
        await page.locator('select[data-reader-text-size-control]').selectOption(textSize);
        await page.evaluate(() => new Promise(requestAnimationFrame));

        const actions = await rectangles(
          page.locator('.doc__page-actions > :is(a, button)'),
        );
        expect(actions.map(({ label }) => label), `${width}/${theme}/${textSize}`).toEqual([
          'Copy page link',
          DOWNLOAD_LABEL,
          'Print this page',
        ]);
        for (const action of actions) {
          expect(action.width, `${width}/${theme}/${textSize}/${action.label} width`).toBeGreaterThanOrEqual(32);
          expect(action.height, `${width}/${theme}/${textSize}/${action.label} height`).toBeGreaterThanOrEqual(32);
          expect(action.left, `${width}/${theme}/${textSize}/${action.label} left`).toBeGreaterThanOrEqual(0);
          expect(action.right, `${width}/${theme}/${textSize}/${action.label} right`).toBeLessThanOrEqual(width);
          expect(action.clipped, `${width}/${theme}/${textSize}/${action.label} clipped`).toBe(false);
        }
        for (let first = 0; first < actions.length; first += 1) {
          for (let second = first + 1; second < actions.length; second += 1) {
            expect(
              intersects(actions[first]!, actions[second]!),
              `${width}/${theme}/${textSize} actions overlap`,
            ).toBe(false);
          }
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          `${width}/${theme}/${textSize} overflow`,
        ).toBe(width);
      }
    }
  }
});

test('the download is keyboard focusable and hidden with all page actions in print', async ({
  page,
}) => {
  await page.goto(WALKTHROUGH_PATH);
  const link = downloadLink(page);
  await link.focus();
  await expect(link).toBeFocused();
  expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.doc__page-actions')).toBeHidden();
  await expect(link).toBeHidden();
  await expect(page.locator('.doc__body')).toBeVisible();
  await expect(page.locator('.doc__body h2')).toHaveCount(19);
});
