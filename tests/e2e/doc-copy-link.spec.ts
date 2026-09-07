import { expect, test, type Page } from '@playwright/test';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const ROUTES = ['/sample/', '/guide/', '/walkthrough/', '/template/'] as const;
const ACTIVATIONS = ['click', 'Enter', 'Space', 'click'] as const;

type ClipboardMode = 'resolve' | 'reject' | 'hold';
type InstrumentedWindow = typeof window & {
  __clipboardWrites: string[];
  __resolveClipboardWrite?: () => void;
  __storageWrites: number;
};

const copyButton = (page: Page) => page.locator('button.doc__copy-button');
const printButton = (page: Page) =>
  page.getByRole('button', { name: 'Print this page', exact: true });

const installInstrumentation = (page: Page, mode: ClipboardMode = 'resolve') =>
  page.addInitScript((clipboardMode) => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__clipboardWrites = [];
    testWindow.__storageWrites = 0;
    let holding = clipboardMode === 'hold';

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          testWindow.__clipboardWrites.push(text);
          if (clipboardMode === 'reject') {
            return Promise.reject(new DOMException('Clipboard write rejected', 'NotAllowedError'));
          }
          if (holding) {
            return new Promise<void>((resolve) => {
              testWindow.__resolveClipboardWrite = () => {
                holding = false;
                resolve();
              };
            });
          }
          return Promise.resolve();
        },
      },
    });

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      testWindow.__storageWrites += 1;
      setItem.call(this, key, value);
    };
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      testWindow.__storageWrites += 1;
      removeItem.call(this, key);
    };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () {
      testWindow.__storageWrites += 1;
      clear.call(this);
    };
  }, mode);

const pageState = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    const content = main?.cloneNode(true) as HTMLElement | undefined;
    content?.querySelector('.doc__page-actions')?.remove();
    const unrelatedFocusableContent = Array.from(
      main?.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )
      .filter((element) => !element.closest('.doc__page-actions'))
      .map((element) => element.outerHTML);
    const testWindow = window as InstrumentedWindow;

    return {
      url: location.href,
      historyLength: history.length,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      mainContent: content?.innerHTML,
      unrelatedFocusableContent,
      localStorage: Object.entries(localStorage).sort(),
      sessionStorage: Object.entries(sessionStorage).sort(),
      storageWrites: testWindow.__storageWrites,
      selection: getSelection()?.toString() ?? '',
    };
  });

test('every reference route has one copy-link action and one print action in its final header wrapper', async ({
  page,
}) => {
  await installInstrumentation(page);

  for (const path of ROUTES) {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(200);

    const wrapper = page.locator('.doc__page-actions');
    await expect(wrapper, `${path} action wrapper`).toHaveCount(1);
    await expect(page.locator('.doc__header > :last-child')).toHaveClass(/doc__page-actions/);
    await expect(copyButton(page), `${path} copy-link action`).toHaveCount(1);
    await expect(copyButton(page), `${path} copy-link name`).toHaveText('Copy page link');
    await expect(printButton(page), `${path} print action`).toHaveCount(1);
    await expect(wrapper.locator('[role="status"]'), `${path} status region`).toHaveCount(1);
    await expect(wrapper.locator('button')).toHaveCount(2);

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical, `${path} canonical URL`).not.toBeNull();
    expect(new URL(canonical!).search, `${path} canonical query`).toBe('');
    expect(new URL(canonical!).hash, `${path} canonical fragment`).toBe('');
  }
});

test('each activation method copies only the absolute canonical URL without page side effects', async ({
  page,
}) => {
  await installInstrumentation(page);
  const requests: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) requests.push(`${request.method()} ${request.url()}`);
  });

  for (const [index, path] of ROUTES.entries()) {
    trackRequests = false;
    requests.length = 0;
    await page.goto(to(`${path}?cache=task-2912#shared`));
    await page.waitForLoadState('networkidle');

    const button = copyButton(page);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    await button.evaluate((element) => element.focus({ preventScroll: true }));
    await page.evaluate(() => window.scrollTo(0, 50));
    const before = await pageState(page);
    trackRequests = true;

    const activation = ACTIVATIONS[index];
    if (activation === 'click') {
      await button.click();
    } else {
      await page.keyboard.press(activation);
    }

    await expect(page.locator('.doc__page-status')).toHaveText('Page link copied.');
    await expect(page.locator('.doc__page-status')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Link copied', exact: true })).toBeFocused();
    expect(
      await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites),
      `${path} ${activation} clipboard writes`,
    ).toEqual([canonical]);

    const after = await pageState(page);
    expect(after, `${path} page state`).toEqual(before);
    expect(requests, `${path} activation requests`).toEqual([]);
  }
});

test('copy feedback keeps print stable, resets, and suppresses concurrent duplicate writes', async ({
  page,
}) => {
  await installInstrumentation(page, 'hold');
  await page.goto(to('/guide/'));

  const button = copyButton(page);
  const print = printButton(page);
  const printBefore = await print.boundingBox();
  await expect(button).toHaveAttribute('aria-busy', 'false');

  await button.evaluate((element) => {
    const copy = element as HTMLButtonElement;
    copy.click();
    copy.click();
  });
  await expect(button).toHaveAttribute('aria-busy', 'true');
  expect(await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites)).toHaveLength(1);

  await page.evaluate(() => (window as InstrumentedWindow).__resolveClipboardWrite?.());
  await expect(page.locator('.doc__page-status')).toHaveText('Page link copied.');
  await expect(button).toHaveAttribute('aria-busy', 'false');
  expect((await print.boundingBox())?.x).toBe(printBefore?.x);

  await page.getByRole('button', { name: 'Link copied', exact: true }).click();
  await expect(page.locator('.doc__page-status')).toHaveText('Page link copied.');
  expect(await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites)).toHaveLength(2);
  expect((await print.boundingBox())?.x).toBe(printBefore?.x);

  await expect(copyButton(page)).toHaveText('Copy page link', { timeout: 2500 });
  expect((await print.boundingBox())?.x).toBe(printBefore?.x);
});

test('a rejected clipboard write announces failure without mutating page or browser state', async ({
  page,
}) => {
  await installInstrumentation(page, 'reject');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.goto(to('/walkthrough/?cache=task-2912#failure'));
  await page.waitForLoadState('networkidle');
  requests.length = 0;

  const button = copyButton(page);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  await button.evaluate((element) => element.focus({ preventScroll: true }));
  await page.evaluate(() => window.scrollTo(0, 50));
  const before = await pageState(page);

  await button.click();

  await expect(page.locator('.doc__page-status')).toHaveCount(1);
  await expect(page.locator('.doc__page-status')).toHaveText('Page link could not be copied.');
  await expect(page.getByRole('button', { name: 'Copy failed', exact: true })).toBeFocused();
  await expect(button).toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(() => (window as InstrumentedWindow).__clipboardWrites)).toEqual([
    canonical,
  ]);
  expect(await pageState(page)).toEqual(before);
  expect(requests).toEqual([]);
});

test('without clipboard writing, every reference route retains only the print action', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  for (const path of ROUTES) {
    await page.goto(to(path));
    await expect(copyButton(page), `${path} copy-link actions`).toHaveCount(0);
    await expect(printButton(page), `${path} print action`).toHaveCount(1);
    await expect(page.locator('.doc__page-actions button'), `${path} available actions`).toHaveCount(1);
    await expect(page.locator('.doc__page-status'), `${path} status regions`).toHaveCount(0);
  }
});

test('print media hides the complete page-action wrapper on every reference route', async ({
  page,
}) => {
  await installInstrumentation(page);
  await page.emulateMedia({ media: 'print' });

  for (const path of ROUTES) {
    await page.goto(to(path));
    await expect(page.locator('.doc__page-actions button')).toHaveCount(2);
    await expect(page.locator('.doc__page-actions')).toBeHidden();
    await expect(page.locator('.doc__page-actions button:visible')).toHaveCount(0);
  }
});

for (const width of [320, 390, 1280]) {
  test(`both page actions meet their target size without overflow at ${width}px`, async ({ page }) => {
    await installInstrumentation(page);
    await page.setViewportSize({ width, height: 844 });

    for (const path of ROUTES) {
      await page.goto(to(path));
      for (const button of [copyButton(page), printButton(page)]) {
        const box = await button.boundingBox();
        expect(box, `${path} action box`).not.toBeNull();
        expect(box!.width, `${path} action width`).toBeGreaterThanOrEqual(32);
        expect(box!.height, `${path} action height`).toBeGreaterThanOrEqual(32);
      }
      if (width < 1280) {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
          `${path} document width`,
        ).toBeLessThanOrEqual(width);
      }
    }
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('reference pages retain their title, body, and links without page actions', async ({ page }) => {
    for (const path of ROUTES) {
      await page.goto(to(path));
      await expect(copyButton(page), `${path} copy-link actions`).toHaveCount(0);
      await expect(printButton(page), `${path} print actions`).toHaveCount(0);
      await expect(page.locator('.doc__header h1'), `${path} title`).toBeVisible();
      await expect(page.locator('.doc__body'), `${path} body`).not.toBeEmpty();
      expect(await page.locator('main a').count(), `${path} links`).toBeGreaterThan(0);
    }
  });
});
