import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  HISTORY_INDEX_DOWNLOAD,
  serializeHistoryIndex,
  type HistoryIndexSource,
} from '../../src/lib/history-index-download';
import {
  historyDownloadFilename,
  historyDownloadPath,
} from '../../src/lib/history-downloads';
import type { HistoryDocument } from '../../src/lib/history';

const BASE = '/prd';
const HISTORY_PAGE = `${BASE}/history/`;
const DOWNLOAD_PATH = `${BASE}${HISTORY_INDEX_DOWNLOAD.path}`;
const snapshotDirectory = resolve('content/gist/history');
const history = JSON.parse(
  readFileSync(resolve('content/gist/history.json'), 'utf8'),
) as HistoryDocument;
const meta = JSON.parse(
  readFileSync(resolve('content/gist/meta.json'), 'utf8'),
) as { revision: string };
const notes = JSON.parse(
  readFileSync(resolve('content/gist/history-notes.json'), 'utf8'),
) as { notes: Record<string, string> };
const source: HistoryIndexSource = {
  history,
  current: meta,
  notes: notes.notes,
  snapshots: Object.fromEntries(
    readdirSync(snapshotDirectory)
      .filter((file) => file.endsWith('.md'))
      .map((file) => [
        `history/${file}`,
        readFileSync(resolve(snapshotDirectory, file)),
      ]),
  ),
};
const expectedBytes = Buffer.from(serializeHistoryIndex(source), 'utf8');

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
  if (!path) throw new Error('The revision history download has no temporary path.');
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

test('the static resource and server-rendered link expose the exact index', async ({
  page,
  request,
}) => {
  const response = await request.get(DOWNLOAD_PATH);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe(HISTORY_INDEX_DOWNLOAD.mime);
  expect(await response.body()).toEqual(expectedBytes);

  await page.goto(HISTORY_PAGE);
  const link = page.locator('a.history-index-download');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText(HISTORY_INDEX_DOWNLOAD.label);
  await expect(link).toHaveAttribute('href', DOWNLOAD_PATH);
  await expect(link).toHaveAttribute('download', HISTORY_INDEX_DOWNLOAD.filename);
  expect(
    await link.evaluate((node) =>
      node.parentElement?.previousElementSibling?.matches('.history-page__story'),
    ),
  ).toBe(true);
  await expect(page.locator('table.history a.history-download')).toHaveCount(16);
  for (const [index, revision] of history.revisions.entries()) {
    const revisionLink = page.locator('table.history a.history-download').nth(index);
    await expect(revisionLink).toHaveAttribute(
      'href',
      `${BASE}${historyDownloadPath(revision)}`,
    );
    await expect(revisionLink).toHaveAttribute(
      'download',
      historyDownloadFilename(revision),
    );
  }
});

test('Chromium downloads and retries without changing page or private browser state', async ({
  page,
}) => {
  await instrument(page);
  const diagnostics = diagnosticsFor(page);
  const observedRequests: {
    method: string;
    postData: string | null;
    url: string;
  }[] = [];
  const downloadUrls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes(HISTORY_INDEX_DOWNLOAD.filename)) {
      observedRequests.push({
        method: request.method(),
        postData: request.postData(),
        url: request.url(),
      });
    }
  });
  await page.goto(HISTORY_PAGE);
  await page.evaluate(() => {
    localStorage.setItem('history-index-private', 'local');
    sessionStorage.setItem('history-index-private', 'session');
    const testWindow = window as InstrumentedWindow;
    testWindow.__storageReads = 0;
    testWindow.__storageWrites = 0;
  });
  const link = page.locator('a.history-index-download');
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
    downloadUrls.push(download.url());
    expect(download.suggestedFilename()).toBe(HISTORY_INDEX_DOWNLOAD.filename);
    expect(await downloadBytes(download)).toEqual(expectedBytes);
    expect(new URL(download.url()).origin).toBe(new URL(page.url()).origin);
  }

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
  expect(downloadUrls).toHaveLength(2);
  expect(
    downloadUrls.every(
      (url) => new URL(url).origin === new URL(page.url()).origin,
    ),
  ).toBe(true);
  for (const request of observedRequests) {
    expect(request.method).toBe('GET');
    expect(request.postData).toBeNull();
    expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
  }
  expect(diagnostics).toEqual([]);
});

test('the index downloads without JavaScript or Clipboard', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(HISTORY_PAGE);
  const link = page.locator('a.history-index-download');
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  const pending = page.waitForEvent('download');
  await link.click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(HISTORY_INDEX_DOWNLOAD.filename);
  expect(await downloadBytes(download)).toEqual(expectedBytes);
  await context.close();
});

test('the link is keyboard-ready, print-hidden, and leaves the History content visible', async ({
  page,
}) => {
  await page.goto(HISTORY_PAGE);
  const link = page.locator('a.history-index-download');
  await link.focus();
  await expect(link).toBeFocused();
  expect(await link.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');
  const content = {
    chartTitle: await page.locator('.history-chart h2').textContent(),
    rows: await page.locator('table.history tbody tr').count(),
  };

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.history-index-action')).toBeHidden();
  await expect(page.locator('.history-chart')).toBeVisible();
  await expect(page.locator('.history-table')).toBeVisible();
  expect(await page.locator('.history-chart h2').textContent()).toBe(content.chartTitle);
  expect(await page.locator('table.history tbody tr').count()).toBe(content.rows);
});

test('the action fits every supported width, theme, and reader size', async ({ page }) => {
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
            const target = action.querySelector('a');
            const story = action.previousElementSibling;
            const chart = action
              .closest('.history-page')
              ?.querySelector('.history-chart');
            if (
              !(target instanceof HTMLElement) ||
              !(story instanceof HTMLElement) ||
              !(chart instanceof HTMLElement)
            ) {
              throw new Error('History index geometry elements are missing.');
            }
            const rect = target.getBoundingClientRect();
            const storyRect = story.getBoundingClientRect();
            const chartRect = chart.getBoundingClientRect();
            const overlaps = (first: DOMRect, second: DOMRect) =>
              first.left < second.right &&
              second.left < first.right &&
              first.top < second.bottom &&
              second.top < first.bottom;
            return {
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
              clipped:
                target.scrollWidth > target.clientWidth ||
                target.scrollHeight > target.clientHeight,
              overlapsStory: overlaps(rect, storyRect),
              overlapsChart: overlaps(rect, chartRect),
              scrollWidth: document.documentElement.scrollWidth,
              viewport: innerWidth,
            };
          });
        expect(
          geometry.width,
          `${width}/${theme}/${textSize} width`,
        ).toBeGreaterThanOrEqual(32);
        expect(
          geometry.height,
          `${width}/${theme}/${textSize} height`,
        ).toBeGreaterThanOrEqual(32);
        expect(
          geometry.left,
          `${width}/${theme}/${textSize} left`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          geometry.right,
          `${width}/${theme}/${textSize} right`,
        ).toBeLessThanOrEqual(width);
        expect(geometry.clipped, `${width}/${theme}/${textSize} clipping`).toBe(false);
        expect(
          geometry.overlapsStory,
          `${width}/${theme}/${textSize} story overlap`,
        ).toBe(false);
        expect(
          geometry.overlapsChart,
          `${width}/${theme}/${textSize} chart overlap`,
        ).toBe(false);
        expect(
          geometry.scrollWidth,
          `${width}/${theme}/${textSize} overflow`,
        ).toBe(geometry.viewport);
      }
    }
  }
  expect(diagnostics).toEqual([]);
});
