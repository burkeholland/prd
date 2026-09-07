import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Locator } from '@playwright/test';
import {
  historyDownloadFilename,
  historyDownloadPath,
} from '../../src/lib/history-downloads';
import type { HistoryDocument } from '../../src/lib/history';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const snapshot = (file: string) => readFileSync(resolve('content/gist', file));
const history = JSON.parse(readFileSync(resolve('content/gist/history.json'), 'utf8')) as HistoryDocument;

const downloadBytes = async (download: Download) => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFileSync(path);
};

test('all historical Markdown URLs and both link placements match their snapshots', async ({ page, request }) => {
  expect(history.count).toBe(16);
  const paths = history.revisions.map(historyDownloadPath);
  expect(new Set(paths).size).toBe(16);

  await page.goto(to('/history/'));
  const indexLinks = page.locator('table.history a.history-download');
  await expect(indexLinks).toHaveCount(16);

  for (const [index, revision] of history.revisions.entries()) {
    const path = to(historyDownloadPath(revision));
    const filename = historyDownloadFilename(revision);
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toMatch(/^text\/markdown;\s*charset=utf-8$/i);
    expect(await response.body(), `${path} byte identity`).toEqual(snapshot(revision.file));

    const indexLink = indexLinks.nth(index);
    await expect(indexLink).toHaveAttribute('href', path);
    await expect(indexLink).toHaveAttribute('download', filename);
  }

  for (const revision of history.revisions) {
    const path = to(historyDownloadPath(revision));
    const filename = historyDownloadFilename(revision);
    await page.goto(to(`/history/${revision.n}/`));
    const revisionLink = page.locator('a.history-download');
    await expect(revisionLink).toHaveCount(1);
    await expect(revisionLink).toHaveText('Download Markdown');
    await expect(revisionLink).toHaveAttribute('href', path);
    await expect(revisionLink).toHaveAttribute('download', filename);
  }
});

type ObservedRequest = { method: string; postData: string | null; url: string };

const expectPrivateDownloads = (
  downloadUrls: string[],
  observedRequests: ObservedRequest[],
  origin: string,
) => {
  expect(downloadUrls).toHaveLength(4);
  for (const url of downloadUrls) {
    expect(new URL(url).origin).toBe(origin);
  }
  for (const request of observedRequests) {
    expect(new URL(request.url).origin, request.url).toBe(origin);
    expect(request.method).toBe('GET');
    expect(request.postData).toBeNull();
  }
};

const revisionShards = Array.from({ length: 4 }, (_, index) =>
  history.revisions.slice(index * 4, index * 4 + 4),
);

for (const revisions of revisionShards) {
  const range = `revisions ${revisions[0]!.n}-${revisions.at(-1)!.n}`;

  test(`index links download ${range} without JavaScript or external requests`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const observedRequests: ObservedRequest[] = [];
    const downloadUrls: string[] = [];
    context.on('request', (request) => {
      observedRequests.push({
        method: request.method(),
        postData: request.postData(),
        url: request.url(),
      });
    });

    await page.goto(to('/history/'));
    const indexLinks = page.locator('table.history a.history-download');
    for (const revision of revisions) {
      const pending = page.waitForEvent('download');
      await indexLinks.nth(revision.n - 1).click();
      const download = await pending;
      downloadUrls.push(download.url());
      expect(download.suggestedFilename()).toBe(historyDownloadFilename(revision));
      expect(await downloadBytes(download)).toEqual(snapshot(revision.file));
    }

    expectPrivateDownloads(downloadUrls, observedRequests, new URL(page.url()).origin);
    await context.close();
  });

  test(`revision-page links download ${range} without JavaScript or external requests`, async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const observedRequests: ObservedRequest[] = [];
    const downloadUrls: string[] = [];
    context.on('request', (request) => {
      observedRequests.push({
        method: request.method(),
        postData: request.postData(),
        url: request.url(),
      });
    });

    for (const revision of revisions) {
      await page.goto(to(`/history/${revision.n}/`));
      const pending = page.waitForEvent('download');
      await page.locator('a.history-download').click();
      const download = await pending;
      downloadUrls.push(download.url());
      expect(download.suggestedFilename()).toBe(historyDownloadFilename(revision));
      expect(await downloadBytes(download)).toEqual(snapshot(revision.file));
    }

    expectPrivateDownloads(downloadUrls, observedRequests, new URL(page.url()).origin);
    await context.close();
  });
}

const rectangles = (locator: Locator) =>
  locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.textContent?.trim() ?? '',
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    }),
  );

const intersects = (
  a: Awaited<ReturnType<typeof rectangles>>[number],
  b: Awaited<ReturnType<typeof rectangles>>[number],
) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test('new links are non-overlapping 32px targets without page overflow', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(to('/history/'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px history overflow`).toBe(width);

    for (const row of await page.locator('table.history tbody tr').all()) {
      const links = await rectangles(row.locator('.history__view a'));
      expect(links.map((link) => link.label)).toEqual(['Diff', 'Markdown', 'GitHub']);
      for (const link of links) {
        expect(link.width, `${width}px ${link.label} width`).toBeGreaterThanOrEqual(32);
        expect(link.height, `${width}px ${link.label} height`).toBeGreaterThanOrEqual(32);
      }
      for (let first = 0; first < links.length; first += 1) {
        for (let second = first + 1; second < links.length; second += 1) {
          expect(intersects(links[first]!, links[second]!), `${width}px index links overlap`).toBe(false);
        }
      }
    }

    await page.goto(to('/history/16/'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px revision overflow`).toBe(width);
    const actions = await rectangles(page.locator('.revision__actions :is(a, button)'));
    expect(actions.map((link) => link.label)).toEqual([
      'View on GitHub',
      'Download Markdown',
      'Copy revision link',
      'the version on the sample page',
    ]);
    for (const link of actions) {
      expect(link.width, `${width}px ${link.label} width`).toBeGreaterThanOrEqual(32);
      expect(link.height, `${width}px ${link.label} height`).toBeGreaterThanOrEqual(32);
    }
    for (let first = 0; first < actions.length; first += 1) {
      for (let second = first + 1; second < actions.length; second += 1) {
        expect(intersects(actions[first]!, actions[second]!), `${width}px revision actions overlap`).toBe(false);
      }
    }
  }
});

test('download actions are keyboard focusable and omitted from the printed revision', async ({ page }) => {
  await page.goto(to('/history/3/'));
  const action = page.locator('.revision__actions a.history-download');
  await action.focus();
  await expect(action).toBeFocused();
  expect(await action.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe('none');

  await page.emulateMedia({ media: 'print' });
  await expect(action).toBeHidden();
  await expect(
    page.locator('.revision__copy-link:visible, .revision__copy-status:visible'),
  ).toHaveCount(0);
  await expect(page.locator('table.diff')).toBeVisible();
  await expect(page.locator('pre.preview')).toHaveCount(0);
});
