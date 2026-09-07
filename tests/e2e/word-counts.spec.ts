import { expect, test, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS, serializePrdMarkdown } from '../../src/lib/prd-template';
import { countPrdWords, formatPrdWordCount } from '../../src/lib/prd-word-count';

const ROUTES = ['/prd/', '/prd/create/'] as const;
const wordCounts = (page: Page) => page.locator('.editor-word-count').allTextContents();
const sectionCounts = (state: PrdEditorState) =>
  PRD_TEMPLATE_SECTIONS.map(({ id }) => formatPrdWordCount(countPrdWords(state.values[id])));
const expectedCounts = (state: PrdEditorState) => [
  formatPrdWordCount(
    countPrdWords(state.title) +
      PRD_TEMPLATE_SECTIONS.reduce(
        (total, { id }) => total + countPrdWords(state.values[id]),
        0,
      ),
  ),
  ...sectionCounts(state),
];
const fixture = (title: string): PrdEditorState => {
  const blank = createBlankPrdEditorState();
  const values = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = index % 3 === 0
      ? `Café ${index} isn't emoji-only 🌱`
      : index % 3 === 1
        ? 'mother-in-law'
        : '';
  }
  return { title, values };
};
const rawDraft = (state: PrdEditorState) =>
  JSON.stringify(createPrdEditorDraftPayload(state, new Date('2026-09-07T20:00:00.000Z')));
const putDraft = (page: Page, state: PrdEditorState) =>
  page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw: rawDraft(state) },
  );

test.beforeEach(async ({ page }) => {
  await page.goto('/prd/');
  await page.evaluate((key) => localStorage.removeItem(key), PRD_EDITOR_STORAGE_KEY);
  await page.reload();
});

for (const route of ROUTES) {
  test(`${route} creates exactly one total and 12 quiet field counts`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('#total-word-count')).toHaveCount(1);
    await expect(page.locator('.editor-section-word-count')).toHaveCount(12);
    expect(await wordCounts(page)).toEqual(Array(13).fill('0 words'));
    await expect(page.locator('#total-word-count')).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.editor-section-word-count[aria-live]')).toHaveCount(0);

    for (const section of PRD_TEMPLATE_SECTIONS) {
      await expect(page.locator(`#section-input-${section.id}`)).toHaveAttribute(
        'aria-describedby',
        new RegExp(`(?:^| )section-word-count-${section.id}(?: |$)`),
      );
    }

    await page.locator('#document-title').fill('Solo');
    await expect(page.locator('#total-word-count')).toHaveText('1 word');
    await page.locator('#section-input-summary-outcome').fill('Decision');
    await expect(page.locator('#section-word-count-summary-outcome')).toHaveText('1 word');
    await expect(page.locator('#total-word-count')).toHaveText('2 words');
  });

  test(`${route} restores all counts without changing saved bytes`, async ({ page }) => {
    const state = fixture('Restored release 2');
    const raw = rawDraft(state);
    await page.goto(route);
    await page.evaluate(
      ({ key, raw }) => localStorage.setItem(key, raw),
      { key: PRD_EDITOR_STORAGE_KEY, raw },
    );
    await page.reload();

    expect(await wordCounts(page)).toEqual(expectedCounts(state));
    expect(await page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY)).toBe(raw);
  });

  test(`${route} updates synchronously without changing focus, selection, scroll, or storage`, async ({
    page,
  }) => {
    await page.goto(route);
    await page.clock.install();
    const result = await page.locator('#section-input-summary-outcome').evaluate(
      (field) => {
        if (!(field instanceof HTMLTextAreaElement)) throw new Error('Missing section field');
        field.value = "One well-known choice 🌱";
        field.focus();
        field.setSelectionRange(4, 14, 'forward');
        field.scrollTop = 7;
        window.scrollTo(0, 20);
        const before = {
          active: document.activeElement?.id,
          start: field.selectionStart,
          end: field.selectionEnd,
          direction: field.selectionDirection,
          fieldScroll: field.scrollTop,
          pageScroll: window.scrollY,
        };
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        return {
          counts: Array.from(
            document.querySelectorAll('.editor-word-count'),
            (node) => node.textContent,
          ),
          before,
          after: {
            active: document.activeElement?.id,
            start: field.selectionStart,
            end: field.selectionEnd,
            direction: field.selectionDirection,
            fieldScroll: field.scrollTop,
            pageScroll: window.scrollY,
          },
          storage: Object.keys(localStorage).length,
        };
      },
    );

    expect(result.counts).toEqual(['3 words', '3 words', ...Array(11).fill('0 words')]);
    expect(result.after).toEqual(result.before);
    expect(result.storage).toBe(0);
  });
}

test('JSON import, Markdown import, and Start over refresh all 13 values', async ({ page }) => {
  const json = fixture('JSON import');
  await page.locator('#backup-file').setInputFiles({
    name: 'draft.prd.json',
    mimeType: 'application/json',
    buffer: Buffer.from(rawDraft(json)),
  });
  expect(await wordCounts(page)).toEqual(expectedCounts(json));

  const markdown = fixture('Markdown import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#markdown-file').setInputFiles({
    name: 'draft.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(serializePrdMarkdown(markdown, { includeBlankSections: false })),
  });
  expect(await wordCounts(page)).toEqual(expectedCounts(markdown));

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  expect(await wordCounts(page)).toEqual(Array(13).fill('0 words'));
});

test('both storage-conflict choices keep counts aligned with the chosen state', async ({
  page,
  context,
}) => {
  const local = fixture('Keep local draft');
  await putDraft(page, local);
  await page.reload();
  const other = await context.newPage();
  await other.goto('/prd/create/');
  const saved = fixture('Load newer saved draft');
  await putDraft(other, saved);
  await expect(page.locator('#draft-conflict')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-saved-draft').click();
  expect(await wordCounts(page)).toEqual(expectedCounts(saved));

  await page.locator('#document-title').fill('Keep this very local draft');
  const kept: PrdEditorState = {
    ...saved,
    title: 'Keep this very local draft',
    values: { ...saved.values },
  };
  await putDraft(other, fixture('Another saved copy'));
  await expect(page.locator('#draft-conflict')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#keep-this-draft').click();
  expect(await wordCounts(page)).toEqual(expectedCounts(kept));
});

test('counts do not alter JSON or Markdown export input', async ({ page }) => {
  const state = fixture('Neutral export');
  await putDraft(page, state);
  await page.reload();
  const before = await page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY);

  await page.evaluate(() => {
    Object.assign(window, { copiedMarkdown: '' });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          (window as typeof window & { copiedMarkdown: string }).copiedMarkdown = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.locator('#copy-markdown').click();

  expect(await page.evaluate(
    () => (window as typeof window & { copiedMarkdown: string }).copiedMarkdown,
  )).toBe(serializePrdMarkdown(state));
  expect(await page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY)).toBe(before);
});

test('counts reflow without overlap or overflow in both themes and text sizes', async ({ page }) => {
  const state = fixture('Responsive total');
  await putDraft(page, state);
  for (const route of ROUTES) {
    for (const width of [320, 390, 1280]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const textSize of ['default', 'large'] as const) {
          await page.setViewportSize({ width, height: 900 });
          await page.emulateMedia({ colorScheme });
          await page.goto(route);
          await page.evaluate((size) => {
            document.documentElement.dataset.textSize = size;
          }, textSize);
          const layout = await page.locator('.editor-word-count').evaluateAll((nodes) => {
            const rects = nodes.map((node) => node.getBoundingClientRect());
            const surrounding = Array.from(document.querySelectorAll<HTMLElement>(
              '#completion-count, #continue-draft, ' +
                '.editor-section-heading--actionable > label, .editor-section-action',
            ))
              .filter((node) => node.getClientRects().length > 0)
              .map((node) => node.getBoundingClientRect());
            const overlaps = (first: DOMRect, second: DOMRect) =>
              first.left < second.right &&
              second.left < first.right &&
              first.top < second.bottom &&
              second.top < first.bottom;
            return {
              overflow: document.documentElement.scrollWidth - window.innerWidth,
              clipped: nodes.filter((node, index) =>
                node.scrollWidth > Math.ceil(rects[index]!.width) + 1 ||
                node.scrollHeight > Math.ceil(rects[index]!.height) + 1
              ).length,
              outside: rects.filter((rect) => rect.left < 0 || rect.right > window.innerWidth + 0.5)
                .length,
              overlaps: rects.filter((rect) =>
                surrounding.some((other) => overlaps(rect, other))
              ).length,
            };
          });
          expect(layout, `${route} ${width} ${colorScheme} ${textSize}`).toEqual({
            overflow: 0,
            clipped: 0,
            outside: 0,
            overlaps: 0,
          });
        }
      }
    }
  }
});

test('counts are absent without JavaScript and hidden in print', async ({ page, browser }) => {
  await page.emulateMedia({ media: 'print' });
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('.editor-word-count:visible')).toHaveCount(0);
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noScriptPage = await context.newPage();
    for (const route of ROUTES) {
      await noScriptPage.goto(route);
      await expect(noScriptPage.locator('.editor-word-count')).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test('typing counts make no requests and produce no page or console errors on either route', async ({
  page,
}) => {
  for (const route of ROUTES) {
    const diagnostics: string[] = [];
    const requests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') diagnostics.push(message.text());
    });
    page.on('pageerror', (error) => diagnostics.push(error.message));
    await page.goto(route);
    page.on('request', (request) => requests.push(request.url()));

    await page.locator('#document-title').fill('No network total');
    await page.locator('#section-input-summary-outcome').fill('One local section');
    await expect(page.locator('#total-word-count')).toHaveText('6 words');
    expect(requests).toEqual([]);
    expect(diagnostics).toEqual([]);
  }
});
