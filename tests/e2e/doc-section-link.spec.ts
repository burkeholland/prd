import { expect, test, type Page } from '@playwright/test';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const ROUTES = {
  '/sample/': 20,
  '/guide/': 11,
  '/walkthrough/': 19,
  '/template/': 12,
} as const;

type ClipboardMode = 'resolve' | 'reject' | 'hold';
type InstrumentedWindow = typeof window & {
  __clipboardAttempts: string[];
  __clipboardSuccesses: string[];
  __finishClipboardWrite?: () => void;
  __historyChanges: number;
  __printCalls: number;
  __sectionAnnouncements: string[];
  __storageWrites: number;
};

const sectionButtons = (page: Page) => page.locator('button.doc__section-link-button');
const sectionStatus = (page: Page) => page.locator('.doc__section-status');
const pageCopyButton = (page: Page) => page.locator('button.doc__copy-button');

const installInstrumentation = (page: Page, mode: ClipboardMode = 'resolve') =>
  page.addInitScript((clipboardMode) => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__clipboardAttempts = [];
    testWindow.__clipboardSuccesses = [];
    testWindow.__historyChanges = 0;
    testWindow.__printCalls = 0;
    testWindow.__sectionAnnouncements = [];
    testWindow.__storageWrites = 0;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          testWindow.__clipboardAttempts.push(text);
          if (clipboardMode === 'reject') {
            throw new DOMException('Clipboard write rejected', 'NotAllowedError');
          }
          if (clipboardMode === 'hold') {
            await new Promise<void>((resolve) => {
              testWindow.__finishClipboardWrite = resolve;
            });
          }
          testWindow.__clipboardSuccesses.push(text);
        },
      },
    });

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

    window.print = () => {
      testWindow.__printCalls += 1;
    };
  }, mode);

const observeSectionAnnouncements = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    const status = document.querySelector('.doc__section-status');
    if (!status) throw new Error('Section status region was not created.');

    new MutationObserver((records) => {
      for (const record of records) {
        const announcement = Array.from(record.addedNodes)
          .map((node) => node.textContent ?? '')
          .join('');
        if (announcement) testWindow.__sectionAnnouncements.push(announcement);
      }
    }).observe(status, { childList: true });
  });

const clipboardState = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    return {
      attempts: testWindow.__clipboardAttempts,
      successes: testWindow.__clipboardSuccesses,
      announcements: testWindow.__sectionAnnouncements,
    };
  });

const neutralPageState = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    const selection = getSelection();
    const pageCopy = document.querySelector('.doc__copy-button');
    const pageStatus = document.querySelector('.doc__page-status');
    const content = document.querySelector('main')?.cloneNode(true) as HTMLElement | undefined;
    content
      ?.querySelectorAll('.doc__section-link-button, .doc__section-status')
      .forEach((node) => node.remove());
    return {
      url: location.href,
      historyLength: history.length,
      historyChanges: testWindow.__historyChanges,
      scrollX,
      scrollY,
      storageWrites: testWindow.__storageWrites,
      printCalls: testWindow.__printCalls,
      printMedia: matchMedia('print').matches,
      content: content?.innerHTML,
      pageCopyText: pageCopy?.textContent,
      pageCopyBusy: pageCopy?.getAttribute('aria-busy'),
      pageStatus: pageStatus?.textContent,
      selection: {
        text: selection?.toString() ?? '',
        anchorOffset: selection?.anchorOffset ?? -1,
        focusOffset: selection?.focusOffset ?? -1,
      },
    };
  });

const expectedSectionUrls = async (page: Page) => {
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).not.toBeNull();
  return sectionButtons(page).evaluateAll(
    (buttons, canonicalHref) =>
      buttons.map((button) => {
        const heading = button.nextElementSibling;
        if (!(heading instanceof HTMLHeadingElement)) {
          throw new Error('Section action is not immediately before its heading.');
        }
        return `${canonicalHref}#${encodeURIComponent(heading.id)}`;
      }),
    canonical!,
  );
};

test('every visible document h2/h3 with an id gets exactly one adjacent action and one shared status', async ({
  page,
}) => {
  await installInstrumentation(page);
  const diagnostics: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.push(error.message));

  for (const [path, expectedCount] of Object.entries(ROUTES)) {
    await page.goto(to(path));

    const eligible = page.locator('.doc__body :is(h2, h3)[id]:visible');
    const buttons = sectionButtons(page);
    await expect(eligible, `${path} eligible headings`).toHaveCount(expectedCount);
    await expect(buttons, `${path} section actions`).toHaveCount(expectedCount);
    await expect(sectionStatus(page), `${path} shared status`).toHaveCount(1);
    await expect(sectionStatus(page)).toHaveAttribute('role', 'status');
    await expect(sectionStatus(page)).toHaveAttribute('aria-live', 'polite');
    await expect(sectionStatus(page)).toHaveAttribute('aria-atomic', 'true');

    const associations = await buttons.evaluateAll((nodes) =>
      nodes.map((node) => {
        const heading = node.nextElementSibling;
        return {
          inBody: Boolean(node.closest('.doc__body')),
          tag: heading?.tagName ?? '',
          id: heading?.id ?? '',
          describedBy: node.getAttribute('aria-describedby') ?? '',
          headingChildren: heading?.childNodes.length ?? 0,
          headingLink: heading?.querySelector(':scope > a.heading-link')?.getAttribute('href') ?? '',
        };
      }),
    );
    expect(associations, `${path} action associations`).toHaveLength(expectedCount);
    for (const association of associations) {
      expect(association.inBody, `${path} action is in the document body`).toBe(true);
      expect(['H2', 'H3'], `${path} associated heading level`).toContain(association.tag);
      expect(association.id, `${path} associated heading id`).not.toBe('');
      expect(association.describedBy, `${path} action description`).toBe(association.id);
      expect(association.headingChildren, `${path} heading contents`).toBe(1);
      expect(association.headingLink, `${path} heading permalink`).toBe(`#${association.id}`);
    }
    for (const heading of await eligible.all()) {
      const authoredName = await heading.locator(':scope > a.heading-link').innerText();
      await expect(heading).toHaveAccessibleName(authoredName);
    }

    await expect(
      page.locator(
        ':is(.doc__header, .toc, h1, h4, [hidden], [aria-hidden="true"]) .doc__section-link-button',
      ),
      `${path} excluded actions`,
    ).toHaveCount(0);
  }

  expect(diagnostics).toEqual([]);
});

test('every action copies its canonical absolute URL plus one encoded heading fragment', async ({
  page,
}) => {
  await installInstrumentation(page);
  const requests: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) requests.push(`${request.method()} ${request.url()}`);
  });

  for (const [path, expectedCount] of Object.entries(ROUTES)) {
    trackRequests = false;
    await page.goto(to(`${path}?cache=task-2985#old-fragment`));
    await page.waitForLoadState('networkidle');
    const expected = await expectedSectionUrls(page);
    expect(expected).toHaveLength(expectedCount);
    expect(expected.every((url) => url.startsWith('https://'))).toBe(true);
    expect(expected.every((url) => !url.includes('?cache='))).toBe(true);
    expect(expected.every((url) => url.split('#').length === 2)).toBe(true);

    requests.length = 0;
    trackRequests = true;
    for (let index = 0; index < expectedCount; index += 1) {
      await sectionButtons(page).nth(index).evaluate((button: HTMLButtonElement) => button.click());
      await expect
        .poll(
          () =>
            page.evaluate(
              () => (window as InstrumentedWindow).__clipboardAttempts.length,
            ),
          { message: `${path} write ${index + 1}` },
        )
        .toBe(index + 1);
    }

    const state = await clipboardState(page);
    expect(state.attempts, `${path} clipboard attempts`).toEqual(expected);
    expect(state.successes, `${path} clipboard writes`).toEqual(expected);
    expect(requests, `${path} activation requests`).toEqual([]);
  }
});

test('click, Enter, and Space each write and announce exactly once with a stable accessible name', async ({
  page,
}) => {
  await installInstrumentation(page);
  await page.goto(to('/guide/'));
  await observeSectionAnnouncements(page);
  const expected = (await expectedSectionUrls(page)).slice(0, 3);
  const activations = ['click', 'Enter', 'Space'] as const;

  for (const [index, activation] of activations.entries()) {
    const button = sectionButtons(page).nth(index);
    await expect(button).toHaveAccessibleName('Copy section link');
    if (activation === 'click') {
      await button.click();
    } else {
      await button.focus();
      await page.keyboard.press(activation);
    }
    await expect(sectionStatus(page)).toHaveText('Section link copied.');
    await expect(button).toHaveAccessibleName('Copy section link');
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as InstrumentedWindow).__sectionAnnouncements.length,
          ),
        { message: `${activation} announcement` },
      )
      .toBe(index + 1);
  }

  expect(await clipboardState(page)).toEqual({
    attempts: expected,
    successes: expected,
    announcements: [
      'Section link copied.',
      'Section link copied.',
      'Section link copied.',
    ],
  });
});

test('one held write suppresses two additional activations of the same action', async ({
  page,
}) => {
  await installInstrumentation(page, 'hold');
  await page.goto(to('/walkthrough/'));
  await observeSectionAnnouncements(page);

  const button = sectionButtons(page).first();
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
    element.click();
  });

  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toHaveAccessibleName('Copy section link');
  expect((await clipboardState(page)).attempts).toHaveLength(1);

  await page.evaluate(() => (window as InstrumentedWindow).__finishClipboardWrite?.());
  await expect(sectionStatus(page)).toHaveText('Section link copied.');
  await expect(button).toHaveAttribute('aria-busy', 'false');
  await expect(button).toHaveAccessibleName('Copy section link');
  expect(await clipboardState(page)).toMatchObject({
    attempts: [expect.stringMatching(/\/walkthrough\/#/)],
    successes: [expect.stringMatching(/\/walkthrough\/#/)],
    announcements: ['Section link copied.'],
  });
});

test('a rejected write announces one failure and preserves selection, focus, and page state', async ({
  page,
}) => {
  await installInstrumentation(page, 'reject');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.goto(to('/guide/?cache=task-2985#old-fragment'));
  await page.waitForLoadState('networkidle');
  requests.length = 0;
  await observeSectionAnnouncements(page);

  const button = sectionButtons(page).nth(2);
  await button.scrollIntoViewIfNeeded();
  await button.evaluate((element: HTMLButtonElement) => element.focus({ preventScroll: true }));
  await page.evaluate(() => {
    const text = document.querySelector('.doc__body p')?.firstChild;
    if (!text) throw new Error('Selection fixture text was not found.');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(12, text.textContent?.length ?? 0));
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  const before = await neutralPageState(page);
  await page.keyboard.press('Enter');
  await expect(sectionStatus(page)).toHaveText('Section link could not be copied.');
  await expect(button).toHaveAccessibleName('Copy section link');
  await expect(button).toBeFocused();
  expect(await neutralPageState(page)).toEqual(before);
  expect(await clipboardState(page)).toEqual({
    attempts: [expect.stringMatching(/\/guide\/#/)],
    successes: [],
    announcements: ['Section link could not be copied.'],
  });
  expect(requests).toEqual([]);
});

test('a successful copy has no URL, history, scroll, storage, network, print, content, or page-link side effects', async ({
  page,
}) => {
  await installInstrumentation(page);
  const requests: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) requests.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(to('/template/?cache=task-2985#old-fragment'));
  await page.waitForLoadState('networkidle');

  const button = sectionButtons(page).nth(5);
  await button.scrollIntoViewIfNeeded();
  await button.evaluate((element: HTMLButtonElement) => element.focus({ preventScroll: true }));
  const before = await neutralPageState(page);
  trackRequests = true;
  await button.evaluate((element: HTMLButtonElement) => element.click());
  await expect(sectionStatus(page)).toHaveText('Section link copied.');

  expect(await neutralPageState(page)).toEqual(before);
  expect(requests).toEqual([]);
  expect(await clipboardState(page)).toMatchObject({
    attempts: [expect.stringMatching(/\/template\/#/)],
    successes: [expect.stringMatching(/\/template\/#/)],
  });
});

test('section copying leaves the page action independent and fragment-free', async ({ page }) => {
  await installInstrumentation(page);
  await page.goto(to('/guide/?cache=task-2985#old-fragment'));

  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(canonical).not.toBeNull();
  const sectionUrl = (await expectedSectionUrls(page))[0];
  await sectionButtons(page).first().click();
  await expect(sectionStatus(page)).toHaveText('Section link copied.');
  await expect(page.locator('.doc__page-status')).toHaveText('');

  await pageCopyButton(page).click();
  await expect(page.locator('.doc__page-status')).toHaveText('Page link copied.');
  await expect(sectionStatus(page)).toHaveText('Section link copied.');
  expect((await clipboardState(page)).attempts).toEqual([sectionUrl, canonical]);
  expect(new URL(canonical!).hash).toBe('');
  expect(new URL(canonical!).search).toBe('');
});

test('without clipboard writing, headings keep their permalinks and no section UI is created', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  for (const [path, expectedCount] of Object.entries(ROUTES)) {
    await page.goto(to(path));
    await expect(sectionButtons(page), `${path} section actions`).toHaveCount(0);
    await expect(sectionStatus(page), `${path} section status`).toHaveCount(0);
    await expect(pageCopyButton(page), `${path} page copy action`).toHaveCount(0);
    await expect(
      page.locator('.doc__body :is(h2, h3)[id] > a.heading-link'),
      `${path} heading permalinks`,
    ).toHaveCount(expectedCount);
    await expect(
      page.getByRole('button', { name: 'Print this page', exact: true }),
      `${path} print fallback`,
    ).toHaveCount(1);
  }
});

test('print hides all section UI while every authored heading and permalink remains', async ({
  page,
}) => {
  await installInstrumentation(page);
  await page.emulateMedia({ media: 'print' });

  for (const [path, expectedCount] of Object.entries(ROUTES)) {
    await page.goto(to(path));
    await expect(sectionButtons(page), `${path} enhanced actions`).toHaveCount(expectedCount);
    await expect(
      page.locator('.doc__section-link-button:visible'),
      `${path} printed actions`,
    ).toHaveCount(0);
    await expect(sectionStatus(page), `${path} printed status`).toBeHidden();
    await expect(
      page.locator('.doc__body :is(h2, h3)[id]:visible'),
      `${path} printed headings`,
    ).toHaveCount(expectedCount);
    await expect(
      page.locator('.doc__body :is(h2, h3)[id] > a.heading-link'),
      `${path} printed permalinks`,
    ).toHaveCount(expectedCount);
  }
});

for (const width of [320, 390, 1280]) {
  test(`section actions are non-overlapping 32px targets without overflow at ${width}px`, async ({
    page,
  }) => {
    await installInstrumentation(page);
    await page.setViewportSize({ width, height: 844 });

    for (const path of Object.keys(ROUTES)) {
      await page.goto(to(path));
      const geometry = await sectionButtons(page).evaluateAll((buttons) => {
        const intersects = (first: DOMRect, second: DOMRect) =>
          first.left < second.right &&
          second.left < first.right &&
          first.top < second.bottom &&
          second.top < first.bottom;

        return buttons.map((button, buttonIndex) => {
          const rect = button.getBoundingClientRect();
          const headingLink = button.nextElementSibling?.querySelector(':scope > a.heading-link');
          const besideHeading = headingLink
            ? Array.from(headingLink.getClientRects()).some(
                (headingRect) =>
                  rect.top < headingRect.bottom && headingRect.top < rect.bottom,
              )
            : false;
          const controls = Array.from(
            document.querySelectorAll<HTMLElement>('.doc__body a, .doc__body button'),
          );
          const overlaps = controls
            .filter((control) => control !== button && getComputedStyle(control).display !== 'none')
            .flatMap((control) => Array.from(control.getClientRects()))
            .some((controlRect) => intersects(rect, controlRect));
          const otherActionOverlap = buttons.some(
            (other, otherIndex) =>
              buttonIndex !== otherIndex && intersects(rect, other.getBoundingClientRect()),
          );
          return {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            besideHeading,
            overlaps,
            otherActionOverlap,
          };
        });
      });

      for (const [index, action] of geometry.entries()) {
        expect(action.width, `${path} action ${index + 1} width`).toBeGreaterThanOrEqual(32);
        expect(action.height, `${path} action ${index + 1} height`).toBeGreaterThanOrEqual(32);
        expect(action.left, `${path} action ${index + 1} left`).toBeGreaterThanOrEqual(0);
        expect(action.right, `${path} action ${index + 1} right`).toBeLessThanOrEqual(width);
        expect(action.besideHeading, `${path} action ${index + 1} beside heading`).toBe(true);
        expect(action.overlaps, `${path} action ${index + 1} control overlap`).toBe(false);
        expect(action.otherActionOverlap, `${path} action ${index + 1} action overlap`).toBe(false);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        `${path} document width`,
      ).toBeLessThanOrEqual(width);
    }
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('all headings and permalinks remain without section actions or status', async ({ page }) => {
    for (const [path, expectedCount] of Object.entries(ROUTES)) {
      await page.goto(to(path));
      await expect(sectionButtons(page), `${path} section actions`).toHaveCount(0);
      await expect(sectionStatus(page), `${path} section status`).toHaveCount(0);
      await expect(
        page.locator('.doc__body :is(h2, h3)[id] > a.heading-link'),
        `${path} heading permalinks`,
      ).toHaveCount(expectedCount);
    }
  });
});
