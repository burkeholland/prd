import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PRD_EDITOR_STORAGE_KEY } from '../../src/lib/prd-editor-state';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const pausedStorageMessage =
  'Saving is paused because this browser could not read local draft storage. Your text is unchanged. Download a draft backup before leaving; try again when storage is available.';
const fieldValues = [
  ' \tAt-risk local title  ',
  ...Array.from(
    { length: 12 },
    (_, index) => ` \tAt-risk local field ${index + 1}\nExact value ${index + 1}  `,
  ),
];
const fields = (page: Page) =>
  page.locator('#prd-editor-form input, #prd-editor-form textarea');
const currentFields = (page: Page) =>
  fields(page).evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value)
  );
const downloadBackup = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.locator('#download-backup').click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing draft backup');
  return JSON.parse(await readFile(path, 'utf8'));
};
const beforeUnloadPrevented = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

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
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('.editor-privacy')).toHaveText(
    'Your draft stays in this browser unless you download it.',
  );
  await expect(page.locator('#download-backup')).toBeEnabled();

  const title = page.locator('#document-title');
  await title.fill('Unsaved but still editable');
  await expect(page.locator('#save-status')).toHaveText(pausedStorageMessage);
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  await expect(title).toBeEditable();
  await expect(title).toHaveValue('Unsaved but still editable');
  await expect(page.locator('#download-backup')).toBeEnabled();
});

test('edited storage-access failure warns on leave, preserves all fields on cancel, and protects saved bytes on departure', async ({
  page,
  context,
}) => {
  const protectedRaw = '{"protected":"newer exact bytes"}';
  const storagePage = await context.newPage();
  await storagePage.goto(to('/create/'));
  await storagePage.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw: protectedRaw },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage disabled', 'SecurityError');
      },
    });
  });
  await page.goto(to('/'));
  for (let index = 0; index < fieldValues.length; index += 1) {
    await fields(page).nth(index).fill(fieldValues[index]!);
  }
  const statusBefore = await page.locator('#save-status').textContent();
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    dialogs += 1;
    if (dialogs === 1) await dialog.dismiss();
    else await dialog.accept();
  });

  await page.getByRole('link', { name: 'Example', exact: true }).click();

  await expect(page).toHaveURL(to('/'));
  expect(dialogs).toBe(1);
  expect(await currentFields(page)).toEqual(fieldValues);
  await expect(page.locator('#save-status')).toHaveText(statusBefore ?? '');
  expect(await storagePage.evaluate(
    (key) => localStorage.getItem(key),
    PRD_EDITOR_STORAGE_KEY,
  )).toBe(protectedRaw);
  expect((await downloadBackup(page)).state).toEqual({
    title: fieldValues[0],
    values: Object.fromEntries(
      await page.locator('textarea').evaluateAll((nodes) =>
        nodes.map((node) => [(node as HTMLTextAreaElement).name, (node as HTMLTextAreaElement).value]),
      ),
    ),
  });

  await page.getByRole('link', { name: 'Example', exact: true }).click();

  await expect(page).toHaveURL(to('/sample/'));
  expect(dialogs).toBe(2);
  expect(await storagePage.evaluate(
    (key) => localStorage.getItem(key),
    PRD_EDITOR_STORAGE_KEY,
  )).toBe(protectedRaw);
  await storagePage.close();
});

test('the leave listener is absent for an unavailable blank editor and tracks only live unsaved risk', async ({
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
  expect(await beforeUnloadPrevented(page)).toBe(false);

  await page.locator('#document-title').fill('Temporary local value');
  expect(await beforeUnloadPrevented(page)).toBe(true);

  await page.locator('#document-title').fill('');
  expect(await beforeUnloadPrevented(page)).toBe(false);
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

  await expect(page.locator('#save-status')).toContainText(
    'could not read local draft storage',
  );
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  const title = page.locator('#document-title');
  await expect(title).toBeEditable();
  await expect(page.locator('textarea')).toHaveCount(12);
  await expect(page.locator('.editor-privacy')).toHaveText(
    'Your draft stays in this browser unless you download it.',
  );
  await expect(page.locator('#download-backup')).toBeEnabled();

  await title.fill('Read failure keeps this local title');
  await page.locator('#save-draft').click();
  await expect(page.locator('#save-status')).toHaveText(pausedStorageMessage);
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  await expect(title).toBeEditable();
  await expect(title).toHaveValue('Read failure keeps this local title');
  await expect(page.locator('#download-backup')).toBeEnabled();

  let warned = false;
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    warned = true;
    await dialog.dismiss();
  });
  await page.getByRole('link', { name: 'Example', exact: true }).click();
  expect(warned).toBe(true);
  await expect(page).toHaveURL(to('/'));
  expect((await downloadBackup(page)).state.title).toBe(
    'Read failure keeps this local title',
  );
});

test('a write failure after editing warns and cancel keeps an exportable in-memory copy', async ({
  page,
}) => {
  await page.goto(to('/'));
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (this === localStorage && storageKey === key) {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return set.call(this, storageKey, value);
    };
  }, PRD_EDITOR_STORAGE_KEY);
  await page.locator('#document-title').fill('Unsaved after write failure');
  await page.locator('#save-draft').click();
  await expect(page.locator('#save-status')).toContainText(
    'Draft could not be saved',
  );
  let warned = false;
  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    warned = true;
    await dialog.dismiss();
  });

  await page.getByRole('link', { name: 'Example', exact: true }).click();

  expect(warned).toBe(true);
  await expect(page).toHaveURL(to('/'));
  await expect(page.locator('#document-title')).toHaveValue(
    'Unsaved after write failure',
  );
  expect((await downloadBackup(page)).state.title).toBe(
    'Unsaved after write failure',
  );
});

test('successful save and restored draft have no active leave warning', async ({
  page,
}) => {
  await page.goto(to('/'));
  await page.locator('#document-title').fill('Safely saved');
  await page.locator('#save-draft').click();
  expect(await beforeUnloadPrevented(page)).toBe(false);

  await page.reload();

  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'restored');
  expect(await beforeUnloadPrevented(page)).toBe(false);
});

test('the four live regions have unique identities and report isolated outcomes accurately', async ({
  page,
}) => {
  await page.goto(to('/'));
  const liveRegions = page.locator(
    '[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(liveRegions).toHaveCount(4);
  expect(
    await liveRegions.evaluateAll((regions) =>
      regions.map((region) => region.id),
    ),
  ).toEqual([
    'total-word-count',
    'save-status',
    'section-copy-status',
    'download-status',
  ]);
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

  const createResponse = await page.goto(to('/create/'));
  expect(createResponse?.status(), '/create/').toBe(200);
  await expect(page.locator('meta[name="robots"]'), '/create/').toHaveAttribute(
    'content',
    'noindex',
  );
  await expect(page.locator('link[rel="canonical"]'), '/create/').toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]'), '/create/').toHaveCount(0);

  const revisionResponse = await page.goto(to('/history/3/'));
  expect(revisionResponse?.status(), '/history/3/').toBe(200);
  await expect(page.locator('meta[name="robots"]'), '/history/3/').toHaveAttribute(
    'content',
    'noindex',
  );
  await expect(page.locator('link[rel="canonical"]'), '/history/3/').toHaveAttribute(
    'href',
    'https://burkeholland.github.io/prd/history/3/',
  );
  await expect(page.locator('meta[property="og:url"]'), '/history/3/').toHaveCount(0);
});

test('reduced-motion users receive the same editor without running animations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(to('/'));
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
