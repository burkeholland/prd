import { expect, test, type Page } from '@playwright/test';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const ROUTES = ['/sample/', '/guide/', '/walkthrough/', '/template/'] as const;
const ACTIVATIONS = ['click', 'Enter', 'Space', 'click'] as const;

type InstrumentedWindow = typeof window & {
  __printCalls: number;
  __storageWrites: number;
};

const printButton = (page: Page) =>
  page.getByRole('button', { name: 'Print this page', exact: true });

const installInstrumentation = (page: Page) =>
  page.addInitScript(() => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__printCalls = 0;
    testWindow.__storageWrites = 0;
    window.print = () => {
      testWindow.__printCalls += 1;
    };

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
  });

test('every document route has one print action after its complete header', async ({ page }) => {
  for (const path of ROUTES) {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(200);

    const button = printButton(page);
    await expect(button, `${path} print action`).toHaveCount(1);
    await expect(button, `${path} visible print action`).toBeVisible();
    await expect(button).toHaveAttribute('type', 'button');
    await expect(page.locator('.doc__header > :last-child')).toHaveClass('doc__print-action');
    await expect(page.locator('.doc__print-action > button')).toHaveCount(1);
  }
});

test('click, Enter, and Space print once without changing page state or making requests', async ({
  page,
}) => {
  await installInstrumentation(page);
  const requests: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });

  for (const [index, path] of ROUTES.entries()) {
    trackRequests = false;
    requests.length = 0;
    await page.goto(to(path));
    await page.waitForLoadState('networkidle');

    const button = printButton(page);
    await expect(button).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 50));
    const before = await page.evaluate(() => {
      const testWindow = window as InstrumentedWindow;
      return {
        url: location.href,
        historyLength: history.length,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        content: document.querySelector('main')?.innerHTML,
        storageWrites: testWindow.__storageWrites,
      };
    });
    trackRequests = true;

    const activation = ACTIVATIONS[index];
    if (activation === 'click') {
      await button.click();
    } else {
      await button.focus();
      await page.keyboard.press(activation);
    }

    expect(
      await page.evaluate(() => (window as InstrumentedWindow).__printCalls),
      `${path} ${activation} print calls`,
    ).toBe(1);
    await expect(button, `${path} focus after ${activation}`).toBeFocused();

    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(button, `${path} focus after afterprint`).toBeFocused();

    const after = await page.evaluate(() => {
      const testWindow = window as InstrumentedWindow;
      return {
        url: location.href,
        historyLength: history.length,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        content: document.querySelector('main')?.innerHTML,
        storageWrites: testWindow.__storageWrites,
      };
    });
    expect(after, `${path} page state`).toEqual(before);
    expect(requests, `${path} activation requests`).toEqual([]);
  }
});

test('the print action is hidden from print media on every document route', async ({ page }) => {
  await page.emulateMedia({ media: 'print' });

  for (const path of ROUTES) {
    await page.goto(to(path));
    const button = page.locator('button.doc__print-button');
    await expect(button, `${path} enhanced action`).toHaveCount(1);
    await expect(button, `${path} printed action`).toBeHidden();
    await expect(page.locator('.doc__print-action:visible'), `${path} visible print controls`).toHaveCount(0);
  }
});

for (const width of [320, 390, 1280]) {
  test(`the print action is usable without horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });

    for (const path of ROUTES) {
      await page.goto(to(path));
      const box = await printButton(page).boundingBox();
      expect(box, `${path} print action box`).not.toBeNull();
      expect(box!.width, `${path} print action width`).toBeGreaterThanOrEqual(32);
      expect(box!.height, `${path} print action height`).toBeGreaterThanOrEqual(32);
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

  test('all document routes keep their content and links without a dead print control', async ({
    page,
  }) => {
    for (const path of ROUTES) {
      const response = await page.goto(to(path));
      expect(response?.status(), `${path} status`).toBe(200);
      await expect(printButton(page), `${path} print actions`).toHaveCount(0);
      await expect(page.locator('.doc__header h1'), `${path} title`).toBeVisible();
      await expect(page.locator('.doc__body'), `${path} document body`).not.toBeEmpty();
      expect(await page.locator('main a').count(), `${path} available links`).toBeGreaterThan(0);
    }
  });
});
