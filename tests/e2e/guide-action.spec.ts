import { expect, test, type Page } from '@playwright/test';

const GUIDE = '/prd/guide/';
const RESET_LABEL = 'Copy handoff checklist';

type InstrumentedWindow = typeof window & {
  __clipboardAttempts: number;
  __clipboardWrites: string[];
  __finishClipboard?: () => void;
  __historyChanges: number;
  __storageWrites: number;
};

const copyButton = (page: Page) =>
  page.locator('button.guide-checklist-copy');

const checklist = (page: Page) =>
  page.locator('#before-you-hand-it-off ~ ul').first();

const renderedLabels = (page: Page) =>
  checklist(page)
    .locator(':scope > li.task-list-item')
    .evaluateAll((items) => items.map((item) => (item as HTMLElement).innerText.trim()));

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
  const items = checklist(page).locator(':scope > li.task-list-item');
  await expect(button).toHaveCount(1);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('type', 'button');
  await expect(button).toHaveAccessibleName(RESET_LABEL);
  await expect(items).toHaveCount(7);
  for (const item of await items.all()) await expect(item).toBeVisible();

  expect(
    await page.locator('.guide-checklist-action').evaluate((action) =>
      action.nextElementSibling?.matches('ul:has(> li.task-list-item)'),
    ),
    'the action sits immediately before the checklist',
  ).toBe(true);

  const labels = await renderedLabels(page);
  const expected = labels.map((label) => `- [ ] ${label}`).join('\n') + '\n';
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
  expect(writes).toEqual([expected]);
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
});

test('announces rejection once without changing the selection', async ({ page }) => {
  await stubClipboard(page, 'reject');
  await page.goto(GUIDE);
  const button = copyButton(page);
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

  await expect(page.locator('.guide-checklist-action')).toHaveCount(0);
  await expect(page.locator('.guide-checklist-status')).toHaveCount(0);
  await expect(checklist(page).locator(':scope > li.task-list-item')).toHaveCount(7);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('keeps all handoff checks without a dead action', async ({ page }) => {
    await page.goto(GUIDE);
    await expect(page.locator('.guide-checklist-action')).toHaveCount(0);
    await expect(page.getByRole('button', { name: RESET_LABEL })).toHaveCount(0);
    const items = checklist(page).locator(':scope > li.task-list-item');
    await expect(items).toHaveCount(7);
    for (const item of await items.all()) await expect(item).toBeVisible();
  });
});

test('print keeps all checks and hides the progressive UI', async ({ page }) => {
  await stubClipboard(page);
  await page.emulateMedia({ media: 'print' });
  await page.goto(GUIDE);

  await expect(copyButton(page)).toHaveCount(1);
  await expect(copyButton(page)).toBeHidden();
  await expect(page.locator('.guide-checklist-status')).toBeHidden();
  const items = checklist(page).locator(':scope > li.task-list-item');
  await expect(items).toHaveCount(7);
  for (const item of await items.all()) await expect(item).toBeVisible();
});

for (const width of [320, 390, 1280]) {
  test(`the action is usable without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await stubClipboard(page);
    await page.setViewportSize({ width, height: 844 });
    await page.goto(GUIDE);

    const box = await copyButton(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(32);
    expect(box!.height).toBeGreaterThanOrEqual(32);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  });
}
