import { expect, test } from '@playwright/test';
import { PRD_EDITOR_STORAGE_KEY } from '../../src/lib/prd-editor-state';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

test('localStorage access failure leaves the editor usable and announces that persistence is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage disabled', 'SecurityError');
      },
    });
  });
  await page.goto(to('/'));

  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  await expect(page.locator('#save-status')).toHaveText(
    'This browser did not allow access to local draft storage. You can still edit this document.',
  );
  await page.locator('#document-title').fill('Unsaved but still editable');
  await expect(page.locator('#document-title')).toHaveValue(
    'Unsaved but still editable',
  );
  await expect(page.locator('#save-status')).toContainText(
    'Draft could not be saved in this browser.',
  );
});

test('a localStorage read failure is explicit and leaves every field editable', async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (storageKey) {
      if (storageKey === key) {
        throw new DOMException('Storage read failed', 'SecurityError');
      }
      return original.call(this, storageKey);
    };
  }, PRD_EDITOR_STORAGE_KEY);
  await page.goto(to('/'));

  await expect(page.locator('#save-status')).toHaveText(
    'This browser could not read local draft storage. You can still edit this document.',
  );
  await expect(page.locator('#document-title')).toBeEditable();
  await expect(page.locator('textarea')).toHaveCount(12);
});

test('the two live regions have unique identities and report save and download outcomes accurately', async ({
  page,
}) => {
  await page.goto(to('/'));
  const liveRegions = page.locator(
    '[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(liveRegions).toHaveCount(2);
  expect(
    await liveRegions.evaluateAll((regions) =>
      regions.map((region) => region.id),
    ),
  ).toEqual(['save-status', 'download-status']);
  await expect(page.locator('#save-status')).toHaveText(
    'No draft saved in this browser yet.',
  );
  await expect(page.locator('#download-status')).toHaveText(
    'Files are generated in this browser.',
  );

  await page.locator('#document-title').fill('Status check');
  await page.locator('#save-draft').click();
  await expect(page.locator('#save-status')).toContainText(
    'Draft saved in this browser at',
  );

  const pendingDownload = page.waitForEvent('download');
  await page.locator('#download-md').click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe('status-check.md');
  await expect(page.locator('#download-status')).toHaveText(
    'Downloaded status-check.md.',
  );
  const currentMessages = await liveRegions.allTextContents();
  expect(new Set(currentMessages).size).toBe(currentMessages.length);
});

test('an offline export failure is announced without a false download or draft loss', async ({
  context,
  page,
}) => {
  await page.goto(to('/'));
  await page.locator('#document-title').fill('Offline draft');
  await page
    .locator('#section-input-summary-outcome')
    .fill('This text remains after an offline export failure.');
  await context.setOffline(true);

  await page.locator('#download-pdf').click();
  await expect(page.locator('#download-status')).toHaveText(
    'Download failed for offline-draft.pdf. Your draft is unchanged.',
  );
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await expect(page.locator('#document-title')).toHaveValue('Offline draft');
  await expect(page.locator('#section-input-summary-outcome')).toHaveValue(
    'This text remains after an offline export failure.',
  );
});

test('home and example fit every supported viewport without horizontal page scrolling', async ({
  page,
}) => {
  for (const width of [320, 390, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    for (const path of ['/', '/sample/']) {
      await page.goto(to(path));
      const dimensions = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `${path} at ${width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);
    }
  }
});

test('secondary and compatibility routes keep their intended status and canonical policy', async ({
  page,
}) => {
  const canonicalRoutes = [
    '/guide/',
    '/walkthrough/',
    '/template/',
    '/history/',
  ];
  for (const path of canonicalRoutes) {
    const response = await page.goto(to(path));
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('link[rel="canonical"]'), path).toHaveAttribute(
      'href',
      `https://burkeholland.github.io${to(path)}`,
    );
  }

  for (const path of ['/create/', '/history/3/']) {
    const response = await page.goto(to(path));
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute(
      'content',
      'noindex',
    );
    await expect(page.locator('link[rel="canonical"]'), path).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]'), path).toHaveCount(0);
  }
});

test('reduced-motion users receive the same editor without running animations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(to('/'));
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
