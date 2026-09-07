import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  extractHandoffChecklistItems,
  HANDOFF_CHECKLIST_FILENAME,
  HANDOFF_CHECKLIST_MIME,
  serializeHandoffChecklist,
} from '../../src/lib/handoff-checklist';

const GUIDE = '/prd/guide/';
const DOWNLOAD = '/prd/downloads/prd-handoff-checklist.md';
const RESET_LABEL = 'Copy handoff checklist';
const EXPECTED_MARKDOWN = serializeHandoffChecklist(
  extractHandoffChecklistItems(
    readFileSync(resolve('content/guide.md'), 'utf8'),
  ),
);

type InstrumentedWindow = typeof window & {
  __clipboardAttempts: number;
  __clipboardWrites: string[];
  __finishClipboard?: () => void;
  __historyChanges: number;
  __storageReads: number;
  __storageWrites: number;
};

const copyButton = (page: Page) =>
  page.locator('button.guide-checklist-copy');

const downloadLink = (page: Page) =>
  page.locator('a.guide-checklist-download');

const checklist = (page: Page) =>
  page.locator('#before-you-hand-it-off ~ ul').first();

const renderedLabels = (page: Page) =>
  checklist(page)
    .locator(':scope > li.task-list-item')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.trim()));

const downloadBytes = async (download: Download) => {
  const path = await download.path();
  if (!path) {
    throw new Error(
      `No temporary path for ${download.suggestedFilename()}.`,
    );
  }
  return readFileSync(path);
};

const stubClipboard = async (
  page: Page,
  behavior: 'resolve' | 'pending' | 'reject' = 'resolve',
) => {
  await page.addInitScript((mode) => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__clipboardAttempts = 0;
    testWindow.__clipboardWrites = [];

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          testWindow.__clipboardAttempts += 1;
          if (mode === 'reject') {
            throw new DOMException('Not allowed', 'NotAllowedError');
          }
          if (mode === 'pending') {
            await new Promise<void>((resolve) => {
              testWindow.__finishClipboard = resolve;
            });
          }
          testWindow.__clipboardWrites.push(text);
        },
      },
    });
  }, behavior);
};

test('copies the seven rendered handoff checks in order with one terminal newline', async ({
  page,
}) => {
  await stubClipboard(page);
  const response = await page.goto(GUIDE);
  expect(response?.status()).toBe(200);

  const button = copyButton(page);
  const download = downloadLink(page);
  const items = checklist(page).locator(':scope > li.task-list-item');
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAccessibleName(RESET_LABEL);
  await expect(download).toHaveCount(1);
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', DOWNLOAD);
  await expect(download).toHaveAttribute('download', '');
  await expect(download).toHaveText('Download checklist (.md)');
  await expect(items).toHaveCount(7);
  for (const item of await items.all()) await expect(item).toBeVisible();

  expect(
    await page.locator('.guide-checklist-action').evaluate((action) =>
      action.nextElementSibling?.matches('ul:has(> li.task-list-item)'),
    ),
    'the action sits immediately before the checklist',
  ).toBe(true);

  const labels = await renderedLabels(page);
  expect(labels.map((label) => `- [ ] ${label}`).join('\n') + '\n').toBe(
    EXPECTED_MARKDOWN,
  );
  await button.focus();
  await page.keyboard.press('Tab');
  await expect(download).toBeFocused();
  await button.click();
  await expect(button).toHaveText('Checklist copied');
  await expect(button).toHaveAccessibleName(RESET_LABEL);
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(page.locator('.guide-checklist-status')).toHaveText(
    'Handoff checklist copied.',
  );

  const writes = await page.evaluate(
    () => (window as InstrumentedWindow).__clipboardWrites,
  );
  expect(writes).toEqual([EXPECTED_MARKDOWN]);
  expect(writes[0].split('\n').slice(0, -1)).toHaveLength(7);
  expect(writes[0].match(/^- \[ \] /gm)).toHaveLength(7);
  expect(writes[0]).toMatch(/[^\n]\n$/);
  expect(writes[0]).not.toMatch(/\n\n$/);
  await expect(button).toHaveText(RESET_LABEL, { timeout: 3000 });

  await expect(page.locator('.doc__body h2')).toHaveCount(4);
  await expect(page.locator('.doc__body h3')).toHaveCount(7);
  await expect(page.locator('.doc__body blockquote')).toHaveCount(7);
  await expect(page.locator('.toc--sidebar .toc__list a')).toHaveCount(11);
});

test('downloads exact local bytes without navigation or state access and retries the same file', async ({
  page,
  request,
}) => {
  await stubClipboard(page);
  await page.addInitScript(() => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__historyChanges = 0;
    testWindow.__storageReads = 0;
    testWindow.__storageWrites = 0;

    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function (...args) {
        testWindow.__historyChanges += 1;
        return original.apply(this, args);
      };
    }

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
  });

  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  const observedRequests: Array<{
    method: string;
    url: string;
    body: string | null;
  }> = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) {
      observedRequests.push({
        method: request.method(),
        url: request.url(),
        body: request.postData(),
      });
    }
  });

  await page.goto(GUIDE);
  await page.waitForLoadState('networkidle');
  const response = await request.get(DOWNLOAD);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe(HANDOFF_CHECKLIST_MIME);
  expect(await response.body()).toEqual(
    Buffer.from(EXPECTED_MARKDOWN, 'utf8'),
  );

  await page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__historyChanges = 0;
    testWindow.__storageReads = 0;
    testWindow.__storageWrites = 0;
  });
  const before = await page.evaluate(() => ({
    href: location.href,
    historyLength: history.length,
  }));
  const href = await downloadLink(page).getAttribute('href');
  trackRequests = true;

  const firstPending = page.waitForEvent('download');
  await downloadLink(page).click();
  const first = await firstPending;
  expect(first.suggestedFilename()).toBe(HANDOFF_CHECKLIST_FILENAME);
  expect(new URL(first.url()).origin).toBe(new URL(page.url()).origin);
  expect(new URL(first.url()).pathname).toBe(DOWNLOAD);
  const firstBytes = await downloadBytes(first);
  expect(firstBytes).toEqual(Buffer.from(EXPECTED_MARKDOWN, 'utf8'));

  await copyButton(page).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as InstrumentedWindow).__clipboardWrites.length,
      ),
    )
    .toBe(1);
  const copied = await page.evaluate(
    () => (window as InstrumentedWindow).__clipboardWrites[0],
  );
  expect(Buffer.from(copied, 'utf8')).toEqual(firstBytes);

  const retryPending = page.waitForEvent('download');
  await downloadLink(page).click();
  const retry = await retryPending;
  expect(retry.suggestedFilename()).toBe(HANDOFF_CHECKLIST_FILENAME);
  expect(retry.url()).toBe(first.url());
  expect(await downloadBytes(retry)).toEqual(firstBytes);
  await expect(downloadLink(page)).toHaveAttribute('href', href!);

  const after = await page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    return {
      href: location.href,
      historyLength: history.length,
      historyChanges: testWindow.__historyChanges,
      storageReads: testWindow.__storageReads,
      storageWrites: testWindow.__storageWrites,
      clipboardAttempts: testWindow.__clipboardAttempts,
    };
  });
  expect(after).toEqual({
    ...before,
    historyChanges: 0,
    storageReads: 0,
    storageWrites: 0,
    clipboardAttempts: 1,
  });
  // Chromium handles attachment requests outside the page request stream. Any
  // entry here is therefore an unrelated side effect of either action.
  expect(observedRequests).toEqual([]);
  expect(diagnostics).toEqual([]);
});

test('click, Enter, and Space each write once without page side effects', async ({
  page,
}) => {
  await stubClipboard(page);
  await page.addInitScript(() => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__historyChanges = 0;
    testWindow.__storageWrites = 0;

    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      history[method] = function (...args) {
        testWindow.__historyChanges += 1;
        return original.apply(this, args);
      };
    }

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
  });

  const requests: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) requests.push(`${request.method()} ${request.url()}`);
  });

  await page.goto(GUIDE);
  await page.waitForLoadState('networkidle');
  const button = copyButton(page);
  await button.scrollIntoViewIfNeeded();
  await button.focus();
  const before = await page.evaluate(() => ({
    url: location.href,
    historyLength: history.length,
    scrollX: scrollX,
    scrollY: scrollY,
  }));
  trackRequests = true;

  await button.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites.length),
    )
    .toBe(1);

  await button.focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites.length),
    )
    .toBe(2);

  await button.focus();
  await page.keyboard.press('Space');
  await expect
    .poll(() =>
      page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites.length),
    )
    .toBe(3);

  const after = await page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    return {
      url: location.href,
      historyLength: history.length,
      scrollX: scrollX,
      scrollY: scrollY,
      historyChanges: testWindow.__historyChanges,
      storageWrites: testWindow.__storageWrites,
      clipboardAttempts: testWindow.__clipboardAttempts,
    };
  });
  expect(after).toMatchObject({
    ...before,
    historyChanges: 0,
    storageWrites: 0,
    clipboardAttempts: 3,
  });
  expect(requests).toEqual([]);
});

test('guards a pending write against duplicate activation', async ({ page }) => {
  await stubClipboard(page, 'pending');
  await page.goto(GUIDE);
  const button = copyButton(page);
  const href = await downloadLink(page).getAttribute('href');

  await button.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveText('Copying…');
  await expect(button).toHaveAccessibleName(RESET_LABEL);
  await expect
    .poll(() =>
      page.evaluate(() => (window as InstrumentedWindow).__clipboardAttempts),
    )
    .toBe(1);

  await button.dispatchEvent('click');
  await button.dispatchEvent('click');
  expect(
    await page.evaluate(() => (window as InstrumentedWindow).__clipboardAttempts),
  ).toBe(1);
  expect(
    await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites),
  ).toEqual([]);

  await page.evaluate(() => (window as InstrumentedWindow).__finishClipboard?.());
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-busy');
  expect(
    await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites),
  ).toHaveLength(1);
  await expect(downloadLink(page)).toHaveAttribute('href', href!);
});

test('announces rejection once without changing the selection or download', async ({
  page,
  request,
}) => {
  await stubClipboard(page, 'reject');
  await page.goto(GUIDE);
  const button = copyButton(page);
  const download = downloadLink(page);
  const href = await download.getAttribute('href');
  const beforeBytes = await (await request.get(DOWNLOAD)).body();
  await button.focus();
  await page.evaluate(() => {
    const text = document.querySelector<HTMLLIElement>(
      '#before-you-hand-it-off ~ ul > li:last-child',
    )?.firstChild;
    if (!text) throw new Error('Checklist selection target is missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const selection = await page.evaluate(() => getSelection()?.toString());

  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Copy failed');
  await expect(button).toHaveAttribute('data-state', 'failed');
  const status = page.locator('.guide-checklist-status[aria-live="polite"]');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText('Copying the handoff checklist failed.');
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(selection);
  expect(
    await page.evaluate(() => (window as InstrumentedWindow).__clipboardAttempts),
  ).toBe(1);
  expect(
    await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites),
  ).toEqual([]);
  await expect(download).toHaveAttribute('href', href!);
  expect(await (await request.get(DOWNLOAD)).body()).toEqual(beforeBytes);
  await expect(button).toHaveText(RESET_LABEL, { timeout: 3000 });
});

test('does not render the enhancement when clipboard writing is unavailable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(GUIDE);

  await expect(page.locator('.guide-checklist-action')).toHaveCount(1);
  await expect(downloadLink(page)).toBeVisible();
  await expect(downloadLink(page)).toHaveAttribute('href', DOWNLOAD);
  await expect(page.locator('.guide-checklist-status')).toHaveCount(0);
  await expect(copyButton(page)).toHaveCount(0);
  await expect(checklist(page).locator(':scope > li.task-list-item')).toHaveCount(7);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('keeps the download and all handoff checks without a dead action', async ({
    page,
  }) => {
    await page.goto(GUIDE);
    await expect(page.locator('.guide-checklist-action')).toHaveCount(1);
    const download = downloadLink(page);
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('href', DOWNLOAD);
    await expect(page.getByRole('button', { name: RESET_LABEL })).toHaveCount(0);
    await expect(page.locator('.guide-checklist-status')).toHaveCount(0);
    const items = checklist(page).locator(':scope > li.task-list-item');
    await expect(items).toHaveCount(7);
    for (const item of await items.all()) await expect(item).toBeVisible();

    const [headingBox, downloadBox, listBox] = await Promise.all([
      page.locator('#before-you-hand-it-off').boundingBox(),
      download.boundingBox(),
      checklist(page).boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(downloadBox).not.toBeNull();
    expect(listBox).not.toBeNull();
    expect(downloadBox!.y).toBeGreaterThanOrEqual(
      headingBox!.y + headingBox!.height,
    );
    expect(downloadBox!.y + downloadBox!.height).toBeLessThanOrEqual(
      listBox!.y,
    );
  });
});

test('print keeps all checks and hides the progressive UI', async ({ page }) => {
  await stubClipboard(page);
  await page.emulateMedia({ media: 'print' });
  await page.goto(GUIDE);

  await expect(copyButton(page)).toHaveCount(1);
  await expect(copyButton(page)).toBeHidden();
  await expect(downloadLink(page)).toBeHidden();
  await expect(page.locator('.guide-checklist-status')).toBeHidden();
  const items = checklist(page).locator(':scope > li.task-list-item');
  await expect(items).toHaveCount(7);
  for (const item of await items.all()) await expect(item).toBeVisible();
});

for (const width of [320, 390, 1280]) {
  test(`both actions wrap safely across preferences at ${width}px`, async ({
    page,
  }) => {
    await stubClipboard(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(GUIDE);

    for (const theme of ['light', 'dark']) {
      await page.locator('select[data-theme-control]').selectOption(theme);
      for (const textSize of ['default', 'large']) {
        await page
          .locator('select[data-reader-text-size-control]')
          .selectOption(textSize);
        const geometry = await page
          .locator('.guide-checklist-action')
          .evaluate((action) => {
            const targets = Array.from(
              action.querySelectorAll<HTMLElement>('button, a'),
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
            const [first, second] = targets;
            return {
              targets,
              overlap:
                first && second
                  ? first.left < second.right &&
                    second.left < first.right &&
                    first.top < second.bottom &&
                    second.top < first.bottom
                  : true,
              scrollWidth: document.documentElement.scrollWidth,
              viewport: innerWidth,
            };
          });

        expect(
          geometry.targets,
          `${width}px ${theme} ${textSize} controls`,
        ).toHaveLength(2);
        expect(
          geometry.overlap,
          `${width}px ${theme} ${textSize} overlap`,
        ).toBe(false);
        expect(
          geometry.scrollWidth,
          `${width}px ${theme} ${textSize} overflow`,
        ).toBe(geometry.viewport);
        for (const target of geometry.targets) {
          expect(
            target.width,
            `${width}px ${theme} ${textSize} ${target.label} width`,
          ).toBeGreaterThanOrEqual(32);
          expect(
            target.height,
            `${width}px ${theme} ${textSize} ${target.label} height`,
          ).toBeGreaterThanOrEqual(32);
          expect(
            target.clipped,
            `${width}px ${theme} ${textSize} ${target.label} clipping`,
          ).toBe(false);
          expect(target.left).toBeGreaterThanOrEqual(0);
          expect(target.right).toBeLessThanOrEqual(geometry.viewport);
        }
      }
    }
  });
}
