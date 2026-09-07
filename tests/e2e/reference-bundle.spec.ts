import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import JSZip from 'jszip';
import {
  REFERENCE_BUNDLE_FILENAME,
  REFERENCE_BUNDLE_FILES,
  REFERENCE_BUNDLE_MIME,
} from '../../src/lib/reference-bundle';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const BUNDLE_PATH = to('/downloads/prd-reference-bundle.zip');
const BUNDLE_LABEL = 'Download reference bundle (.zip)';
const expectedNames = REFERENCE_BUNDLE_FILES.map(({ filename }) => filename);

const downloadBytes = async (download: Download): Promise<Buffer> => {
  expect(download.suggestedFilename()).toBe(REFERENCE_BUNDLE_FILENAME);
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('Reference bundle download has no temporary path.');
  return readFile(path);
};

const clickBundle = async (page: Page): Promise<Download> => {
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: BUNDLE_LABEL }).click();
  return pending;
};

test('bundle route and native download return the exact five standalone resources twice', async ({
  browser,
  request,
}) => {
  const response = await request.get(BUNDLE_PATH);
  const routeBytes = await response.body();
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe(REFERENCE_BUNDLE_MIME);

  const context = await browser.newContext({
    acceptDownloads: true,
    javaScriptEnabled: false,
  });
  try {
    const page = await context.newPage();
    await page.goto(to('/'));
    const bundle = page.getByRole('link', { name: BUNDLE_LABEL });
    await expect(bundle).toHaveCount(1);
    await expect(bundle).toHaveAttribute('href', BUNDLE_PATH);
    await expect(bundle).toHaveAttribute('download', '');

    const pageUrl = page.url();
    const firstBytes = await downloadBytes(await clickBundle(page));
    const secondBytes = await downloadBytes(await clickBundle(page));
    expect(page.url()).toBe(pageUrl);
    expect(firstBytes).toEqual(routeBytes);
    expect(secondBytes).toEqual(firstBytes);

    const zip = await JSZip.loadAsync(firstBytes);
    expect(Object.keys(zip.files)).toEqual(expectedNames);
    expect(Object.values(zip.files).every((entry) => !entry.dir)).toBe(true);
    for (const { filename } of REFERENCE_BUNDLE_FILES) {
      const standalone = await request.get(to(`/downloads/${filename}`));
      expect(standalone.status(), filename).toBe(200);
      expect(await zip.file(filename)?.async('nodebuffer'), filename).toEqual(
        await standalone.body(),
      );
    }
  } finally {
    await context.close();
  }
});

test('home owns the only static bundle action and keeps state, URL, and diagnostics neutral', async ({
  page,
}) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  const requestOrigins = new Set<string>();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  page.on('request', (request) => requestOrigins.add(new URL(request.url()).origin));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  await page.goto(to('/'));
  expect(await page.evaluate(() => navigator.clipboard)).toBeUndefined();
  await expect(page.locator('.portable-references')).toContainText(
    'Includes the Guide, handoff checklist, Walkthrough, Template guidance, and blank template.',
  );
  await expect(
    page.locator(`main a[href="${BUNDLE_PATH}"]`),
  ).toHaveCount(1);

  for (const path of [
    '/create/',
    '/sample/',
    '/guide/',
    '/walkthrough/',
    '/template/',
    '/history/',
    '/history/3/',
  ]) {
    await page.goto(to(path));
    await expect(
      page.locator(`a[href="${BUNDLE_PATH}"]`),
      path,
    ).toHaveCount(0);
  }

  await page.goto(to('/'));
  await page.locator('#document-title').fill('Private bundle sentinel');
  await page.locator('#save-draft').click();
  const before = await page.evaluate(() => ({
    historyLength: history.length,
    local: Object.entries(localStorage).sort(),
    session: Object.entries(sessionStorage).sort(),
    url: location.href,
  }));
  const bytes = await downloadBytes(await clickBundle(page));
  expect(bytes.byteLength).toBeGreaterThan(0);
  const after = await page.evaluate(() => ({
    historyLength: history.length,
    local: Object.entries(localStorage).sort(),
    session: Object.entries(sessionStorage).sort(),
    url: location.href,
  }));
  expect(after).toEqual(before);

  const ownOrigin = new URL(page.url()).origin;
  expect([...requestOrigins]).toEqual([ownOrigin]);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('bundle action fits every requested reader setting, receives keyboard focus, and does not print', async ({
  page,
}) => {
  const viewports = [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ];
  const settings = [
    { theme: 'light', textSize: 'default' },
    { theme: 'dark', textSize: 'default' },
    { theme: 'light', textSize: 'large' },
    { theme: 'dark', textSize: 'large' },
  ] as const;

  await page.goto(to('/'));
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const setting of settings) {
      await page.evaluate(({ theme, textSize }) => {
        document.documentElement.dataset.theme = theme;
        if (textSize === 'large') {
          document.documentElement.dataset.textSize = textSize;
        } else {
          delete document.documentElement.dataset.textSize;
        }
      }, setting);
      const action = page.getByRole('link', { name: BUNDLE_LABEL });
      await action.scrollIntoViewIfNeeded();
      const geometry = await action.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const copy = node.parentElement?.querySelector('p')?.getBoundingClientRect();
        return {
          rect: {
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          },
          overlapsCopy: copy
            ? rect.left < copy.right &&
              copy.left < rect.right &&
              rect.top < copy.bottom &&
              copy.top < rect.bottom
            : true,
          clipped:
            node.scrollWidth > node.clientWidth ||
            node.scrollHeight > node.clientHeight,
          pageWidth: document.documentElement.scrollWidth,
        };
      });
      const label = `${viewport.width}px ${setting.theme}/${setting.textSize}`;
      expect(geometry.rect.width, label).toBeGreaterThanOrEqual(32);
      expect(geometry.rect.height, label).toBeGreaterThanOrEqual(32);
      expect(geometry.rect.left, label).toBeGreaterThanOrEqual(0);
      expect(geometry.rect.right, label).toBeLessThanOrEqual(viewport.width);
      expect(geometry.rect.top, label).toBeGreaterThanOrEqual(0);
      expect(geometry.rect.bottom, label).toBeLessThanOrEqual(viewport.height);
      expect(geometry.overlapsCopy, label).toBe(false);
      expect(geometry.clipped, label).toBe(false);
      expect(geometry.pageWidth, label).toBe(viewport.width);
    }
  }

  await page.emulateMedia({ media: 'screen' });
  await page.locator('.editor-outline a').last().focus();
  await page.keyboard.press('Tab');
  const action = page.getByRole('link', { name: BUNDLE_LABEL });
  await expect(action).toBeFocused();
  const focus = await action.evaluate((node) => {
    const style = getComputedStyle(node);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).not.toBe('0px');

  await page.emulateMedia({ media: 'print' });
  await expect(action).toBeHidden();
  await expect(page.locator('.portable-references:visible')).toHaveCount(0);
});
