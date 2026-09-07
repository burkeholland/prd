import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { HistoryDocument } from '../../src/lib/history';
import {
  historyDownloadFilename,
  historyDownloadPath,
} from '../../src/lib/history-downloads';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const history = JSON.parse(
  readFileSync(resolve('content/gist/history.json'), 'utf8'),
) as HistoryDocument;
const canonicalHref = (revision: number) =>
  `https://burkeholland.github.io/prd/history/${revision}/`;
const revisionShards = Array.from({ length: 4 }, (_, index) =>
  history.revisions.slice(index * 4, index * 4 + 4),
);

type ClipboardMode = 'resolve' | 'reject' | 'reject-once' | 'hold';
type InstrumentedWindow = typeof window & {
  __announcements: string[];
  __announcementObserver?: MutationObserver;
  __clipboardSuccesses: number;
  __clipboardWrites: string[];
  __historyMutations: number;
  __printCalls: number;
  __releaseClipboardWrite?: () => void;
  __storageWrites: number;
};

const copyButton = (page: Page, revision: number) =>
  page.getByRole('button', {
    name: `Copy revision ${revision} link`,
    exact: true,
  });
const copyStatus = (page: Page) =>
  page.locator(
    '.revision__copy-status[role="status"][aria-live="polite"][aria-atomic="true"]',
  );

const installInstrumentation = (
  page: Page,
  mode: ClipboardMode = 'resolve',
) =>
  page.addInitScript((clipboardMode) => {
    const testWindow = window as InstrumentedWindow;
    testWindow.__clipboardWrites = [];
    testWindow.__clipboardSuccesses = 0;
    testWindow.__historyMutations = 0;
    testWindow.__storageWrites = 0;
    testWindow.__printCalls = 0;
    let holding = clipboardMode === 'hold';
    let rejectionsRemaining = clipboardMode === 'reject-once' ? 1 : 0;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(text: string) {
          testWindow.__clipboardWrites.push(text);
          if (clipboardMode === 'reject' || rejectionsRemaining > 0) {
            rejectionsRemaining = Math.max(0, rejectionsRemaining - 1);
            return Promise.reject(
              new DOMException('Clipboard write rejected', 'NotAllowedError'),
            );
          }
          if (holding) {
            return new Promise<void>((resolve) => {
              testWindow.__releaseClipboardWrite = () => {
                holding = false;
                testWindow.__clipboardSuccesses += 1;
                resolve();
              };
            });
          }
          testWindow.__clipboardSuccesses += 1;
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

    const pushState = History.prototype.pushState;
    History.prototype.pushState = function (data, unused, url) {
      testWindow.__historyMutations += 1;
      return pushState.call(this, data, unused, url);
    };
    const replaceState = History.prototype.replaceState;
    History.prototype.replaceState = function (data, unused, url) {
      testWindow.__historyMutations += 1;
      return replaceState.call(this, data, unused, url);
    };
    window.print = () => {
      testWindow.__printCalls += 1;
    };
  }, mode);

const watchAnnouncements = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    const status = document.querySelector('.revision__copy-status');
    if (!(status instanceof HTMLElement)) {
      throw new Error('Revision copy status was not created.');
    }
    testWindow.__announcements = [];
    testWindow.__announcementObserver?.disconnect();
    testWindow.__announcementObserver = new MutationObserver(() => {
      const message = status.textContent?.trim();
      if (message) testWindow.__announcements.push(message);
    });
    testWindow.__announcementObserver.observe(status, {
      childList: true,
      subtree: true,
    });
  });

const diagnosticsFor = (page: Page) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.push(`console: ${message.text()}`);
    }
  });
  return diagnostics;
};

const copyInvariantState = (page: Page) =>
  page.evaluate(() => {
    const testWindow = window as InstrumentedWindow;
    const selection = getSelection();
    const nodePath = (node: Node | null) => {
      const path: number[] = [];
      let current = node;
      while (current && current !== document) {
        const parent = current.parentNode;
        if (!parent) break;
        path.push(Array.prototype.indexOf.call(parent.childNodes, current));
        current = parent;
      }
      return path.reverse();
    };
    const endpoint = (node: Node | null, offset: number) => ({
      path: nodePath(node),
      offset,
    });
    const download = document.querySelector<HTMLAnchorElement>(
      'a.history-download',
    );
    return {
      url: location.href,
      historyLength: window.history.length,
      historyMutations: testWindow.__historyMutations,
      storageWrites: testWindow.__storageWrites,
      localStorage: Object.entries(localStorage).sort(),
      sessionStorage: Object.entries(sessionStorage).sort(),
      revisionHtml: document.querySelector(
        '.revision__diff, .revision__first',
      )?.innerHTML,
      navigation: Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          '.revision__nav a, .site-nav a',
        ),
        (link) => ({ href: link.href, text: link.textContent }),
      ),
      download: {
        href: download?.getAttribute('href'),
        filename: download?.getAttribute('download'),
      },
      theme: document.documentElement.dataset.theme,
      textSize: document.documentElement.dataset.textSize,
      printCalls: testWindow.__printCalls,
      scroll: { x: scrollX, y: scrollY },
      selection: {
        text: selection?.toString(),
        rangeCount: selection?.rangeCount,
        anchor: endpoint(
          selection?.anchorNode ?? null,
          selection?.anchorOffset ?? 0,
        ),
        focus: endpoint(
          selection?.focusNode ?? null,
          selection?.focusOffset ?? 0,
        ),
        ranges: selection
          ? Array.from({ length: selection.rangeCount }, (_, index) => {
              const range = selection.getRangeAt(index);
              return {
                start: endpoint(range.startContainer, range.startOffset),
                end: endpoint(range.endContainer, range.endOffset),
              };
            })
          : [],
      },
    };
  });

const selectRevisionText = (
  page: Page,
  start: number,
  end: number,
  scrollY: number,
) =>
  page.evaluate(
    ({ rangeStart, rangeEnd, targetScrollY }) => {
      const targets = document.querySelectorAll(
        '.revision__diff td:nth-child(4), .revision__first .preview',
      );
      let text: Text | undefined;
      for (const target of targets) {
        const walker = document.createTreeWalker(
          target,
          NodeFilter.SHOW_TEXT,
        );
        let candidate = walker.nextNode();
        while (candidate) {
          if (candidate instanceof Text && candidate.length >= rangeEnd) {
            text = candidate;
            break;
          }
          candidate = walker.nextNode();
        }
        if (text) break;
      }
      if (!text) throw new Error('Expected selectable revision text.');

      const range = document.createRange();
      range.setStart(text, rangeStart);
      range.setEnd(text, rangeEnd);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      window.scrollTo(0, targetScrollY);
      return {
        scroll: { x: scrollX, y: scrollY },
        selection: selection?.toString(),
      };
    },
    { rangeStart: start, rangeEnd: end, targetScrollY: scrollY },
  );

expect(history.count).toBe(16);
expect(history.revisions.map(({ n }) => n)).toEqual(
  Array.from({ length: 16 }, (_, index) => index + 1),
);

for (const revisions of revisionShards) {
  const range = `${revisions[0]!.n}-${revisions.at(-1)!.n}`;

  test(`revisions ${range} each copy their absolute canonical URL`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: `http://localhost:${process.env.PREVIEW_PORT ?? 4411}`,
    });
    const page = await context.newPage();
    const diagnostics = diagnosticsFor(page);
    await installInstrumentation(page);

    for (const revision of revisions) {
      await page.goto(
        to(`/history/${revision.n}/?cache=revision-${revision.n}#existing`),
      );
      const button = copyButton(page, revision.n);
      const status = copyStatus(page);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveText('Copy revision link');
      await expect(button).toHaveAccessibleName(
        `Copy revision ${revision.n} link`,
      );
      await expect(status).toHaveCount(1);

      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute(
        'href',
        canonicalHref(revision.n),
      );
      const canonicalValue = await canonical.getAttribute('href');
      expect(new URL(canonicalValue!).search).toBe('');
      expect(new URL(canonicalValue!).hash).toBe('');

      await watchAnnouncements(page);
      await button.click();
      await expect(status).toHaveText(
        `Revision ${revision.n} link copied.`,
      );
      await expect(button).toHaveAccessibleName(
        `Copy revision ${revision.n} link`,
      );
      await expect(button).toBeFocused();
      expect(
        await page.evaluate(
          () => (window as InstrumentedWindow).__clipboardWrites,
        ),
      ).toEqual([canonicalHref(revision.n)]);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as InstrumentedWindow).__announcements,
          ),
        )
        .toEqual([`Revision ${revision.n} link copied.`]);
    }

    expect(diagnostics).toEqual([]);
    await context.close();
  });
}

test('initially unfocused pointer, Enter, and Space each write and announce once', async ({
  page,
}) => {
  await installInstrumentation(page);
  const diagnostics = diagnosticsFor(page);
  const requests: string[] = [];
  const downloads: string[] = [];
  let trackRequests = false;
  page.on('request', (request) => {
    if (trackRequests) {
      requests.push(
        `${request.method()} ${request.url()} ${request.postData() ?? ''}`,
      );
    }
  });
  page.on('download', (download) => downloads.push(download.url()));
  const representatives = [
    { activation: 'pointer', n: 1 },
    { activation: 'pointer', n: 8 },
    { activation: 'pointer', n: 16 },
    { activation: 'Enter', n: 8 },
    { activation: 'Space', n: 16 },
  ] as const;

  for (const { activation, n } of representatives) {
    trackRequests = false;
    requests.length = 0;
    downloads.length = 0;
    await page.goto(to(`/history/${n}/?cache=${activation}#old-fragment`));
    await page.waitForLoadState('networkidle');
    const button = copyButton(page, n);
    await watchAnnouncements(page);
    const before = await copyInvariantState(page);
    if (activation === 'pointer') await expect(button).not.toBeFocused();
    trackRequests = true;

    if (activation === 'pointer') {
      await button.click();
    } else {
      await button.focus();
      await button.press(activation);
    }

    await expect(copyStatus(page)).toHaveText(`Revision ${n} link copied.`);
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName(`Copy revision ${n} link`);
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardWrites,
      ),
    ).toEqual([canonicalHref(n)]);
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardSuccesses,
      ),
    ).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as InstrumentedWindow).__announcements,
        ),
      )
      .toEqual([`Revision ${n} link copied.`]);
    trackRequests = false;
    expect(await copyInvariantState(page)).toEqual(before);
    expect(requests).toEqual([]);
    expect(downloads).toEqual([]);
  }
  expect(diagnostics).toEqual([]);
});

test('a pending write suppresses duplicate activations until settlement', async ({
  page,
}) => {
  await installInstrumentation(page, 'hold');
  await page.goto(to('/history/8/'));
  const button = copyButton(page, 8);
  await watchAnnouncements(page);

  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await button.press('Enter');
  await button.press('Space');
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__clipboardWrites,
    ),
  ).toEqual([canonicalHref(8)]);
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__clipboardSuccesses,
    ),
  ).toBe(0);
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__announcements,
    ),
  ).toEqual([]);

  await page.evaluate(() =>
    (window as InstrumentedWindow).__releaseClipboardWrite?.(),
  );
  await expect(copyStatus(page)).toHaveText('Revision 8 link copied.');
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(button).toBeFocused();
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__clipboardSuccesses,
    ),
  ).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as InstrumentedWindow).__announcements,
      ),
    )
    .toEqual(['Revision 8 link copied.']);

  await button.press('Enter');
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__clipboardWrites,
    ),
  ).toEqual([canonicalHref(8), canonicalHref(8)]);
  expect(
    await page.evaluate(
      () => (window as InstrumentedWindow).__clipboardSuccesses,
    ),
  ).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as InstrumentedWindow).__announcements,
      ),
    )
    .toEqual(['Revision 8 link copied.', 'Revision 8 link copied.']);
});

test('a detached copy action is not focused after a successful settlement', async ({
  page,
}) => {
  await installInstrumentation(page, 'hold');
  const diagnostics = diagnosticsFor(page);
  await page.goto(to('/history/8/'));
  const button = copyButton(page, 8);

  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  const result = await page.evaluate(async () => {
    const copyAction = document.querySelector('.revision__copy-link');
    if (!(copyAction instanceof HTMLButtonElement)) {
      throw new Error('Expected the revision copy action.');
    }
    copyAction.remove();
    (window as InstrumentedWindow).__releaseClipboardWrite?.();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      active: document.activeElement === copyAction,
      connected: copyAction.isConnected,
    };
  });

  expect(result).toEqual({ active: false, connected: false });
  await expect(copyStatus(page)).toHaveText('Revision 8 link copied.');
  expect(diagnostics).toEqual([]);
});

for (const activation of ['pointer', 'Enter', 'Space'] as const) {
  test(`rejected ${activation} activation restores selection, scroll, and action focus`, async ({
    page,
  }) => {
    await installInstrumentation(page, 'reject');
    const diagnostics = diagnosticsFor(page);
    const requests: string[] = [];
    const downloads: string[] = [];
    let trackRequests = false;
    page.on('request', (request) => {
      if (trackRequests) {
        requests.push(
          `${request.method()} ${request.url()} ${request.postData() ?? ''}`,
        );
      }
    });
    page.on('download', (download) => downloads.push(download.url()));

    await page.goto(to(`/history/3/?cache=rejection-${activation}#existing`));
    await page.waitForLoadState('networkidle');
    const button = copyButton(page, 3);
    await page.evaluate((keyboardActivation) => {
      localStorage.setItem('revision-link-test', 'local value');
      sessionStorage.setItem('revision-link-test', 'session value');
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.textSize = 'large';

      const copyAction = document.querySelector('.revision__copy-link');
      if (!(copyAction instanceof HTMLButtonElement)) {
        throw new Error('Expected the revision copy action.');
      }
      if (keyboardActivation) copyAction.focus({ preventScroll: true });

      const target = document.querySelector(
        '.revision__diff td:nth-child(4)',
      );
      const text = target?.firstChild;
      if (!(text instanceof Text) || text.length < 12) {
        throw new Error('Expected selectable revision text.');
      }
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, 12);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      window.scrollTo(0, 60);
      (window as InstrumentedWindow).__storageWrites = 0;
    }, activation !== 'pointer');
    await watchAnnouncements(page);
    const before = await copyInvariantState(page);
    expect(before.scroll.y).toBeGreaterThan(0);
    expect(before.selection).toMatchObject({
      text: expect.any(String),
      rangeCount: 1,
      anchor: { offset: 2 },
      focus: { offset: 12 },
      ranges: [{ start: { offset: 2 }, end: { offset: 12 } }],
    });
    expect(before.selection.text).toHaveLength(10);
    if (activation === 'pointer') {
      await expect(button).not.toBeFocused();
    } else {
      await expect(button).toBeFocused();
    }
    trackRequests = true;

    if (activation === 'pointer') {
      await button.click();
    } else {
      await button.press(activation);
    }

    await expect(copyStatus(page)).toHaveText(
      'Revision 3 link could not be copied.',
    );
    await expect(button).toBeFocused();
    await expect(button).not.toHaveAttribute('aria-busy');
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardWrites,
      ),
    ).toEqual([canonicalHref(3)]);
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardSuccesses,
      ),
    ).toBe(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as InstrumentedWindow).__announcements,
        ),
      )
      .toEqual(['Revision 3 link could not be copied.']);
    expect(await copyInvariantState(page)).toEqual(before);
    expect(requests).toEqual([]);
    expect(downloads).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
}

test('a rejected pointer activation can retry successfully without late restoration', async ({
  page,
}) => {
  await installInstrumentation(page, 'reject-once');
  const diagnostics = diagnosticsFor(page);

  for (const n of [1, 8, 16]) {
    await page.goto(to(`/history/${n}/?cache=pointer-retry#existing`));
    await page.waitForLoadState('networkidle');
    const button = copyButton(page, n);
    await selectRevisionText(page, 2, 12, 60);
    await watchAnnouncements(page);
    const beforeRejection = await copyInvariantState(page);
    expect(beforeRejection.scroll.y).toBeGreaterThan(0);
    await expect(button).not.toBeFocused();

    await button.click();

    await expect(copyStatus(page)).toHaveText(
      `Revision ${n} link could not be copied.`,
    );
    await expect(button).toBeFocused();
    expect(await copyInvariantState(page)).toEqual(beforeRejection);

    await button.click();

    await expect(copyStatus(page)).toHaveText(`Revision ${n} link copied.`);
    await expect(button).toBeFocused();
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardWrites,
      ),
    ).toEqual([canonicalHref(n), canonicalHref(n)]);
    expect(
      await page.evaluate(
        () => (window as InstrumentedWindow).__clipboardSuccesses,
      ),
    ).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as InstrumentedWindow).__announcements,
        ),
      )
      .toEqual([
        `Revision ${n} link could not be copied.`,
        `Revision ${n} link copied.`,
      ]);

    const postRetryState = await selectRevisionText(page, 1, 6, 100);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(() => ({
        scroll: { x: scrollX, y: scrollY },
        selection: getSelection()?.toString(),
      })),
    ).toEqual(postRetryState);
  }

  expect(diagnostics).toEqual([]);
});

test('clipboard-absent and JavaScript-disabled revisions retain all existing content', async ({
  browser,
}) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      baseURL: `http://localhost:${process.env.PREVIEW_PORT ?? 4411}`,
      javaScriptEnabled,
    });
    if (javaScriptEnabled) {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: undefined,
        });
      });
    }
    const page = await context.newPage();

    for (const revision of history.revisions) {
      await page.goto(to(`/history/${revision.n}/`));
      await expect(page.locator('.revision__copy-link')).toHaveCount(0);
      await expect(page.locator('.revision__copy-status')).toHaveCount(0);
      await expect(
        page.locator('.revision__actions > a', {
          hasText: 'View on GitHub',
        }),
      ).toHaveCount(1);
      await expect(
        page.locator('.revision__actions > a.history-download'),
      ).toHaveCount(1);
      await expect(page.locator('.revision__nav')).toHaveCount(2);
      const expectedNavigation = [
        ...(revision.n > 1 ? ['Previous'] : []),
        'All revisions',
        ...(revision.n < history.count ? ['Next'] : []),
      ];
      for (const navigation of await page.locator('.revision__nav').all()) {
        await expect(navigation.locator('a')).toHaveText(expectedNavigation);
      }
      await expect(
        page.locator('.revision__diff, .revision__first'),
      ).toHaveCount(1);
      await expect(page.locator('footer')).toBeVisible();
      if (revision.n === history.count) {
        await expect(page.locator('.revision__actions .badge')).toHaveCount(1);
      }
    }

    await context.close();
  }
});

test('copying does not alter or start representative Markdown downloads', async ({
  page,
  request,
}) => {
  await installInstrumentation(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.url()));

  for (const n of [1, 8, 16]) {
    const revision = history.revisions[n - 1]!;
    await page.goto(to(`/history/${n}/`));
    const download = page.locator('a.history-download');
    const expected = {
      href: to(historyDownloadPath(revision)),
      filename: historyDownloadFilename(revision),
    };
    await expect(download).toHaveAttribute('href', expected.href);
    await expect(download).toHaveAttribute('download', expected.filename);

    await copyButton(page, n).click();
    await expect(copyStatus(page)).toHaveText(`Revision ${n} link copied.`);
    await expect(download).toHaveAttribute('href', expected.href);
    await expect(download).toHaveAttribute('download', expected.filename);
    expect(downloads).toEqual([]);

    const response = await request.get(expected.href);
    expect(await response.body()).toEqual(
      readFileSync(resolve('content/gist', revision.file)),
    );
  }
});

test('copy action and status are absent from representative printed revisions', async ({
  page,
}) => {
  await installInstrumentation(page);
  await page.emulateMedia({ media: 'print' });

  for (const n of [1, 8, 16]) {
    await page.goto(to(`/history/${n}/`));
    await expect(page.locator('.revision__copy-link')).toHaveCount(1);
    await expect(page.locator('.revision__copy-link')).toBeHidden();
    await expect(copyStatus(page)).toBeHidden();
    await expect(
      page.locator('.revision__actions > a', {
        hasText: 'View on GitHub',
      }),
    ).toBeVisible();
    await expect(page.locator('a.history-download')).toBeHidden();
    await expect(
      page.locator(n === 1 ? 'pre.preview' : 'table.diff'),
    ).toBeVisible();
  }
});

test('all revision actions fit and remain distinct at required widths', async ({
  page,
}) => {
  await installInstrumentation(page);

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(to('/history/16/'));
    const geometry = await page
      .locator('.revision__actions a, .revision__actions > button')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            label: node.textContent?.trim(),
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            clipped:
              node.scrollWidth > node.clientWidth ||
              node.scrollHeight > node.clientHeight,
          };
        }),
      );
    expect(geometry.map(({ label }) => label)).toEqual([
      'View on GitHub',
      'Download Markdown',
      'Copy revision link',
      'the version on the sample page',
    ]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    for (const action of geometry) {
      expect(action.width, `${width}px ${action.label} width`).toBeGreaterThanOrEqual(32);
      expect(action.height, `${width}px ${action.label} height`).toBeGreaterThanOrEqual(32);
      expect(action.left, `${width}px ${action.label} left`).toBeGreaterThanOrEqual(0);
      expect(action.right, `${width}px ${action.label} right`).toBeLessThanOrEqual(width);
      expect(action.top, `${width}px ${action.label} top`).toBeGreaterThanOrEqual(0);
      expect(action.bottom, `${width}px ${action.label} bottom`).toBeLessThanOrEqual(900);
      expect(action.clipped, `${width}px ${action.label} clipped`).toBe(false);
    }
    for (let first = 0; first < geometry.length; first += 1) {
      for (let second = first + 1; second < geometry.length; second += 1) {
        const a = geometry[first]!;
        const b = geometry[second]!;
        expect(
          a.left < b.right &&
            b.left < a.right &&
            a.top < b.bottom &&
            b.top < a.bottom,
          `${width}px ${a.label} overlaps ${b.label}`,
        ).toBe(false);
      }
    }
  }
});
