import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  HISTORY_CSV_DOWNLOAD,
  serializeHistoryCsv,
} from '../../src/lib/history-csv-download';
import { HISTORY_INDEX_DOWNLOAD } from '../../src/lib/history-index-download';
import type { HistoryDocument } from '../../src/lib/history';

const BASE = '/prd';
const HISTORY_PAGE = `${BASE}/history/`;
const DOWNLOAD_PATH = `${BASE}${HISTORY_CSV_DOWNLOAD.path}`;
const history = JSON.parse(
  readFileSync(resolve('content/gist/history.json'), 'utf8'),
) as HistoryDocument;
const meta = JSON.parse(
  readFileSync(resolve('content/gist/meta.json'), 'utf8'),
) as { revision: string };
const expectedBytes = Buffer.from(
  serializeHistoryCsv({ history, current: meta }),
  'utf8',
);

type InstrumentedWindow = typeof window & {
  __clipboardWrites: string[];
  __historyMutations: number;
  __storageReads: number;
  __storageWrites: number;
};

const instrument = (page: Page) =>
  page.addInitScript(() => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__clipboardWrites = [];
    testWindow.__historyMutations = 0;
    testWindow.__storageReads = 0;
    testWindow.__storageWrites = 0;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          testWindow.__clipboardWrites.push(text);
          return Promise.resolve();
        },
      },
    });

    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      testWindow.__storageReads += 1;
      return getItem.call(this, key);
    };
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      testWindow.__storageWrites += 1;
      return setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      testWindow.__storageWrites += 1;
      return removeItem.call(this, key);
    };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      testWindow.__storageWrites += 1;
      return clear.call(this);
    };
    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (data, unused, url) {
      testWindow.__historyMutations += 1;
      return pushState.call(this, data, unused, url);
    };
    const replaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (data, unused, url) {
      testWindow.__historyMutations += 1;
      return replaceState.call(this, data, unused, url);
    };
  });

const downloadBytes = async (download: Download) => {
  const path = await download.path();
  if (!path) throw new Error('The revision history CSV has no temporary path.');
  return readFileSync(path);
};

const diagnosticsFor = (page: Page) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
  });
  return diagnostics;
};

test('the prerendered CSV and single History link expose the exact metadata', async ({
  page,
  request,
}) => {
  const first = await request.get(DOWNLOAD_PATH);
  const second = await request.get(DOWNLOAD_PATH);
  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe(HISTORY_CSV_DOWNLOAD.mime);
  expect(await first.body()).toEqual(expectedBytes);
  expect(await second.body()).toEqual(expectedBytes);

  await page.goto(HISTORY_PAGE);
  const link = page.locator('a.history-csv-download');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(HISTORY_CSV_DOWNLOAD.label);
  await expect(link).toHaveAttribute('href', DOWNLOAD_PATH);
  await expect(link).toHaveAttribute('download', HISTORY_CSV_DOWNLOAD.filename);
  await expect(page.locator(`a[href="${DOWNLOAD_PATH}"]`)).toHaveCount(1);
  await expect(page.locator('.history-index-action a')).toHaveCount(2);
  await expect(page.locator('a.history-index-download')).toHaveText(
    HISTORY_INDEX_DOWNLOAD.label,
  );
  await expect(page.locator('table.history tbody tr')).toHaveCount(16);
  await expect(page.locator('table.history a.history-download')).toHaveCount(16);

  for (const path of ['/', '/sample/', '/guide/', '/walkthrough/', '/template/']) {
    await page.goto(`${BASE}${path}`);
    await expect(page.locator('a.history-csv-download')).toHaveCount(0);
    await expect(page.locator(`a[href="${DOWNLOAD_PATH}"]`)).toHaveCount(0);
  }
});

test('native downloads, retries, and header fallback preserve page and private state', async ({
  page,
}) => {
  await instrument(page);
  const diagnostics = diagnosticsFor(page);
  await page.goto(HISTORY_PAGE);
  await page.evaluate(() => {
    localStorage.setItem('history-csv-private', 'local');
    sessionStorage.setItem('history-csv-private', 'session');
    const testWindow = window as InstrumentedWindow;
    testWindow.__storageReads = 0;
    testWindow.__storageWrites = 0;
  });
  const observedRequests: {
    method: string;
    postData: string | null;
    url: string;
  }[] = [];
  page.on('request', (request) => {
    observedRequests.push({
      method: request.method(),
      postData: request.postData(),
      url: request.url(),
    });
  });
  const link = page.locator('a.history-csv-download');
  const before = await page.evaluate(() => ({
    url: location.href,
    historyLength: window.history.length,
    local: Object.entries(localStorage).sort(),
    session: Object.entries(sessionStorage).sort(),
    chart: document.querySelector('.history-chart')?.innerHTML,
    table: document.querySelector('.history-table')?.innerHTML,
  }));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pending = page.waitForEvent('download');
    await link.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(HISTORY_CSV_DOWNLOAD.filename);
    expect(await downloadBytes(download)).toEqual(expectedBytes);
  }

  await link.evaluate((node) => node.removeAttribute('download'));
  const fallbackPending = page.waitForEvent('download');
  await link.click();
  const fallback = await fallbackPending;
  expect(fallback.suggestedFilename()).toBe(HISTORY_CSV_DOWNLOAD.filename);
  expect(await downloadBytes(fallback)).toEqual(expectedBytes);

  const after = await page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    return {
      url: location.href,
      historyLength: window.history.length,
      local: Object.entries(localStorage).sort(),
      session: Object.entries(sessionStorage).sort(),
      chart: document.querySelector('.history-chart')?.innerHTML,
      table: document.querySelector('.history-table')?.innerHTML,
      clipboard: testWindow.__clipboardWrites,
      historyMutations: testWindow.__historyMutations,
      storageReads: testWindow.__storageReads,
      storageWrites: testWindow.__storageWrites,
    };
  });
  expect(after).toMatchObject({
    ...before,
    clipboard: [],
    historyMutations: 0,
    storageReads: 0,
    storageWrites: 0,
  });
  expect(observedRequests.length).toBeGreaterThanOrEqual(1);
  for (const request of observedRequests) {
    expect(request.method).toBe('GET');
    expect(request.postData).toBeNull();
    expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
  }
  expect(diagnostics).toEqual([]);
});

test('the actions work without JavaScript, fit all presentations, focus, and hide in print', async ({
  browser,
  page,
}) => {
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(HISTORY_PAGE);
  const noScriptLink = noScriptPage.locator('a.history-csv-download');
  const pending = noScriptPage.waitForEvent('download');
  await noScriptLink.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(HISTORY_CSV_DOWNLOAD.filename);
  expect(await downloadBytes(download)).toEqual(expectedBytes);
  await noScript.close();

  const diagnostics = diagnosticsFor(page);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(HISTORY_PAGE);
    for (const theme of ['light', 'dark'] as const) {
      for (const textSize of ['default', 'large'] as const) {
        await page.locator('html').evaluate(
          (root, presentation) => {
            root.dataset.theme = presentation.theme;
            if (presentation.textSize === 'large') root.dataset.textSize = 'large';
            else delete root.dataset.textSize;
          },
          { theme, textSize },
        );
        const geometry = await page
          .locator('.history-index-action')
          .evaluate((action) => {
            const targets = Array.from(action.querySelectorAll<HTMLElement>('a'));
            const story = action.previousElementSibling;
            const chart = action
              .closest('.history-page')
              ?.querySelector('.history-chart');
            if (
              targets.length !== 2 ||
              !(story instanceof HTMLElement) ||
              !(chart instanceof HTMLElement)
            ) {
              throw new Error('History download action geometry is incomplete.');
            }
            const boxes = targets.map((target) => {
              const rect = target.getBoundingClientRect();
              return {
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
            });
            const storyRect = story.getBoundingClientRect();
            const chartRect = chart.getBoundingClientRect();
            const overlaps = (
              first: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
              second: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
            ) =>
              first.left < second.right &&
              second.left < first.right &&
              first.top < second.bottom &&
              second.top < first.bottom;
            return {
              boxes,
              overlap: overlaps(boxes[0]!, boxes[1]!),
              storyOverlap: boxes.some((box) => overlaps(box, storyRect)),
              chartOverlap: boxes.some((box) => overlaps(box, chartRect)),
              scrollWidth: document.documentElement.scrollWidth,
              viewport: innerWidth,
            };
          });
        for (const box of geometry.boxes) {
          expect(box.width, `${width}/${theme}/${textSize} width`).toBeGreaterThanOrEqual(32);
          expect(box.height, `${width}/${theme}/${textSize} height`).toBeGreaterThanOrEqual(32);
          expect(box.left, `${width}/${theme}/${textSize} left`).toBeGreaterThanOrEqual(0);
          expect(box.right, `${width}/${theme}/${textSize} right`).toBeLessThanOrEqual(width);
          expect(box.clipped, `${width}/${theme}/${textSize} clipping`).toBe(false);
        }
        expect(geometry.overlap, `${width}/${theme}/${textSize} action overlap`).toBe(false);
        expect(geometry.storyOverlap, `${width}/${theme}/${textSize} story overlap`).toBe(false);
        expect(geometry.chartOverlap, `${width}/${theme}/${textSize} chart overlap`).toBe(false);
        expect(geometry.scrollWidth, `${width}/${theme}/${textSize} overflow`).toBe(
          geometry.viewport,
        );
      }
    }
  }

  const csvLink = page.locator('a.history-csv-download');
  await csvLink.focus();
  await expect(csvLink).toBeFocused();
  expect(await csvLink.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe(
    'none',
  );
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.history-index-action')).toBeHidden();
  await expect(page.locator('.history-chart')).toBeVisible();
  await expect(page.locator('.history-table')).toBeVisible();
  expect(diagnostics).toEqual([]);
});
