import { expect, test, type Page } from '@playwright/test';

const PATH = '/prd/template/';
const MARKDOWN_PATH = '/prd/downloads/prd-template.md';
const SUCCESS = 'Copied the whole blank Markdown template.';
const FAILURE = 'Copy failed. Use the Markdown download instead.';

type ActionWindow = typeof window & {
  __templateClipboardAttempts: string[];
  __templateClipboardWrites: string[];
  __templateFetchCalls: number;
  __templateHistoryChanges: number;
  __templateStorageWrites: number;
  __resolveTemplateFetch?: (response: Response) => void;
};

const copyButton = (page: Page) => page.locator('button.template-copy-all');

const copyStatus = (page: Page) =>
  page.locator('main .copy-status[role="status"][aria-live="polite"]');

const installActionInstrumentation = (
  page: Page,
  clipboard: 'resolve' | 'reject' = 'resolve',
) =>
  page.addInitScript((clipboardMode) => {
    const testWindow = window as ActionWindow;
    testWindow.__templateClipboardAttempts = [];
    testWindow.__templateClipboardWrites = [];
    testWindow.__templateFetchCalls = 0;
    testWindow.__templateHistoryChanges = 0;
    testWindow.__templateStorageWrites = 0;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          testWindow.__templateClipboardAttempts.push(text);
          if (clipboardMode === 'reject') {
            return Promise.reject(
              new DOMException('Clipboard write denied', 'NotAllowedError'),
            );
          }
          testWindow.__templateClipboardWrites.push(text);
          return Promise.resolve();
        },
      },
    });

    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (...args) {
      testWindow.__templateHistoryChanges += 1;
      return pushState.apply(this, args);
    };
    const replaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (...args) {
      testWindow.__templateHistoryChanges += 1;
      return replaceState.apply(this, args);
    };

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      testWindow.__templateStorageWrites += 1;
      return setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      testWindow.__templateStorageWrites += 1;
      return removeItem.call(this, key);
    };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      testWindow.__templateStorageWrites += 1;
      return clear.call(this);
    };
  }, clipboard);

const actionState = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as ActionWindow;
    return {
      url: location.href,
      historyLength: history.length,
      historyChanges: testWindow.__templateHistoryChanges,
      storageWrites: testWindow.__templateStorageWrites,
    };
  });

const clipboardState = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as ActionWindow;
    return {
      attempts: testWindow.__templateClipboardAttempts,
      writes: testWindow.__templateClipboardWrites,
    };
  });

test('copies the fetched canonical UTF-8 text and resets without moving the action', async ({
  page,
}) => {
  await installActionInstrumentation(page);
  const fetchedText = '# Blank PRD\r\n\r\nExact UTF-8: café\r\n';
  const requests: string[] = [];
  await page.route(`**${MARKDOWN_PATH}`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: fetchedText,
    });
  });

  await page.goto(PATH);
  const button = copyButton(page);
  await expect(button).toHaveCount(1);
  await expect(page.locator('button.copy-button')).toHaveCount(12);
  await expect(copyStatus(page)).toHaveCount(1);
  await expect(copyStatus(page)).toHaveAttribute('aria-atomic', 'true');
  expect(
    await button.evaluate((element) => element.previousElementSibling?.textContent),
  ).toBe('PDF');

  const markdown = page.locator(
    `.template-download-actions a[download][href="${MARKDOWN_PATH}"]`,
  );
  await expect(markdown).toHaveText('Markdown');
  const restingWidth = (await button.boundingBox())!.width;

  await button.click();
  await expect(button).toHaveText('Copied');
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(button).toBeEnabled();
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(copyStatus(page)).toHaveText(SUCCESS);

  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).pathname).toBe(MARKDOWN_PATH);
  const { attempts, writes } = await clipboardState(page);
  expect(attempts).toEqual([fetchedText]);
  expect(writes).toEqual([fetchedText]);
  expect(Array.from(new TextEncoder().encode(writes[0]))).toEqual(
    Array.from(new TextEncoder().encode(fetchedText)),
  );
  expect(Math.abs((await button.boundingBox())!.width - restingWidth)).toBeLessThanOrEqual(1);

  await expect(button).toHaveText('Copy blank Markdown', { timeout: 3_000 });
  expect(Math.abs((await button.boundingBox())!.width - restingWidth)).toBeLessThanOrEqual(1);
});

test('Enter and Space copy sequentially without changing URL, history, or storage', async ({
  page,
}) => {
  await installActionInstrumentation(page);
  const requests: string[] = [];
  await page.route(`**${MARKDOWN_PATH}`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/markdown; charset=utf-8',
      body: '# Sequential copy\n',
    });
  });
  await page.goto(PATH);
  const before = await actionState(page);
  const button = copyButton(page);

  await button.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await clipboardState(page)).writes.length).toBe(1);
  await expect(button).toBeEnabled();

  await button.focus();
  await page.keyboard.press('Space');
  await expect.poll(async () => (await clipboardState(page)).writes.length).toBe(2);

  expect(requests).toHaveLength(2);
  expect((await clipboardState(page)).attempts).toEqual([
    '# Sequential copy\n',
    '# Sequential copy\n',
  ]);
  await expect(copyStatus(page)).toHaveText(SUCCESS);
  await expect(copyStatus(page)).toHaveCount(1);
  await expect(copyButton(page)).toHaveCount(1);
  expect(await actionState(page)).toEqual(before);
});

test('a busy activation cannot start a second fetch or clipboard write', async ({ page }) => {
  await installActionInstrumentation(page);
  await page.addInitScript(() => {
    const testWindow = window as ActionWindow;
    let resolveFetch: (response: Response) => void = () => {};
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    testWindow.__resolveTemplateFetch = resolveFetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: () => {
        testWindow.__templateFetchCalls += 1;
        return pendingFetch;
      },
    });
  });
  await page.goto(PATH);
  const button = copyButton(page);
  const restingWidth = (await button.boundingBox())!.width;

  await button.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveText('Copying…');
  expect(Math.abs((await button.boundingBox())!.width - restingWidth)).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => (window as ActionWindow).__templateFetchCalls),
  ).toBe(1);
  expect((await clipboardState(page)).attempts).toEqual([]);

  await page.evaluate(() => {
    const testWindow = window as ActionWindow;
    testWindow.__resolveTemplateFetch?.(
      new Response('# One pending copy\n', {
        status: 200,
        headers: { 'content-type': 'text/markdown; charset=utf-8' },
      }),
    );
  });
  await expect(copyStatus(page)).toHaveText(SUCCESS);
  await expect(button).toBeEnabled();
  expect(
    await page.evaluate(() => (window as ActionWindow).__templateFetchCalls),
  ).toBe(1);
  expect((await clipboardState(page)).writes).toEqual(['# One pending copy\n']);
});

for (const failure of ['HTTP response', 'fetch rejection', 'clipboard rejection'] as const) {
  test(`${failure} keeps the page unselected and points to the Markdown download`, async ({
    page,
  }) => {
    await installActionInstrumentation(
      page,
      failure === 'clipboard rejection' ? 'reject' : 'resolve',
    );
    let fetchCalls = 0;

    if (failure === 'fetch rejection') {
      await page.addInitScript(() => {
        const testWindow = window as ActionWindow;
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          value: () => {
            testWindow.__templateFetchCalls += 1;
            return Promise.reject(new TypeError('Network unavailable'));
          },
        });
      });
    } else {
      await page.route(`**${MARKDOWN_PATH}`, async (route) => {
        fetchCalls += 1;
        if (failure === 'HTTP response') {
          await route.fulfill({ status: 503, body: 'Unavailable' });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/markdown; charset=utf-8',
            body: '# Clipboard rejection\n',
          });
        }
      });
    }

    await page.goto(PATH);
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const before = await actionState(page);
    const button = copyButton(page);
    await button.click();

    await expect(button).toHaveText('Copy failed');
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute('aria-busy');
    await expect(copyStatus(page)).toHaveText(FAILURE);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
    expect((await clipboardState(page)).writes).toEqual([]);
    expect((await clipboardState(page)).attempts).toHaveLength(
      failure === 'clipboard rejection' ? 1 : 0,
    );
    const observedFetchCalls = failure === 'fetch rejection'
      ? await page.evaluate(() => (window as ActionWindow).__templateFetchCalls)
      : fetchCalls;
    expect(observedFetchCalls).toBe(1);
    expect(await actionState(page)).toEqual(before);
    await expect(
      page.locator(`a[download][href="${MARKDOWN_PATH}"]`),
    ).toHaveText('Markdown');
    await expect(page.locator('button.copy-button')).toHaveCount(12);
  });
}

for (const unavailable of ['Clipboard API', 'clipboard text writing', 'fetch'] as const) {
  test(`does not offer the whole-template action without ${unavailable}`, async ({ page }) => {
    await page.addInitScript((missing) => {
      if (missing === 'fetch') {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          value: undefined,
        });
        return;
      }
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: missing === 'Clipboard API' ? undefined : {},
      });
    }, unavailable);

    await page.goto(PATH);
    await expect(copyButton(page)).toHaveCount(0);
    await expect(page.locator('.template-copy-all')).toHaveCount(0);
    await expect(page.locator('button.copy-button')).toHaveCount(12);
    await expect(
      page.locator(`a[download][href="${MARKDOWN_PATH}"]`),
    ).toBeVisible();
    expect((await page.request.get(MARKDOWN_PATH)).status()).toBe(200);
  });
}

test('the whole-template copy action is absent from print output', async ({ page }) => {
  await installActionInstrumentation(page);
  await page.goto(PATH);
  await expect(copyButton(page)).toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  await expect(copyButton(page)).toBeHidden();
  await expect(page.locator('.template-copy-all:visible')).toHaveCount(0);
});
