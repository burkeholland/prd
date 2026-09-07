import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PRD_EDITOR_STORAGE_KEY } from '../../src/lib/prd-editor-state';
import { normalizePrdTitle, PRD_TEMPLATE } from '../../src/lib/prd-template';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// A4 at 96 dpi: 210mm × 297mm. Print media is emulated at this viewport so the `@media print`
// rules apply and the document has exactly one paper width to fit in.
const A4 = { width: 794, height: 1123 };

const LONG_TITLE = `  ${'A complete requirements document for a carefully planned product launch. '.repeat(5)}LONG-TITLE-END  `;
const UNICODE_SENTENCE = 'Caf\u00e9 d\u00e9j\u00e0 vu: l\u2019\u00e9quipe pr\u00e9pare une cr\u00e8me br\u00fbl\u00e9e \u00e0 Montr\u00e9al.';
const LONG_URL = `https://example.invalid/${'a'.repeat(300)}LONG-URL-END`;
const ANSWER_LINES = Array.from(
  { length: 80 },
  (_, index) => `ANSWER-${String(index + 1).padStart(3, '0')}: This complete line belongs in the printed requirements.`,
);
const PRINT_VALUES = PRD_TEMPLATE.sections.map((section, index) =>
  index === 0
    ? `${ANSWER_LINES.join('\n')}\n\n  Indented text with    readable spacing.\n${LONG_URL}\n${UNICODE_SENTENCE}`
    : `Content for ${section.title}.\nSECTION-${index + 1}-FINAL`,
);

async function populatePrintFixture(page: Page) {
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  await page.locator('#document-title').fill(LONG_TITLE);
  await page.locator('#save-draft').click();
  // Change only the live fields, without input events or a save: printing must not use stored state.
  await page.locator('.editor-section textarea').evaluateAll((nodes, values) => {
    nodes.forEach((node, index) => {
      if (!(node instanceof HTMLTextAreaElement)) throw new Error('Expected an editor textarea');
      node.value = values[index];
      node.scrollTop = 0;
    });
  }, PRINT_VALUES);
}

async function readPrintedPdf(bytes: Buffer) {
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loading.promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
    }
    return { pages: document.numPages, text: pages.join('\n') };
  } finally {
    await loading.destroy();
  }
}

const compact = (text: string) => text.replace(/\s+/gu, '');

async function editorScreenState(page: Page) {
  return page.evaluate(() => ({
    fields: Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      '#prd-editor-form input, #prd-editor-form textarea',
    ), (field) => ({
      id: field.id,
      value: field.value,
      disabled: field.disabled,
      readOnly: field.readOnly,
      tabIndex: field.tabIndex,
      selectionStart: field.selectionStart,
      selectionEnd: field.selectionEnd,
      scrollTop: field.scrollTop,
    })),
    storage: Object.entries(localStorage).sort(),
    actions: Array.from(document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
      '.editor-tools button, .editor-tools a',
    ), (action) => ({ text: action.textContent, id: action.id, tabIndex: action.tabIndex })),
    navigation: Array.from(document.querySelectorAll<HTMLAnchorElement>('.site-nav a, .editor-outline a'),
      (link) => ({ text: link.textContent, href: link.href })),
    statuses: Array.from(document.querySelectorAll('.editor-status, #download-status'),
      (node) => node.textContent),
    activeId: document.activeElement?.id,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
}

async function expectPrintDocument(page: Page, title: string, values: readonly string[]) {
  await expect(page.locator('h1:visible')).toHaveText(normalizePrdTitle(title));
  await expect(page.locator('h1:visible')).toHaveCount(1);
  await expect(page.locator('h2:visible')).toHaveText(PRD_TEMPLATE.sections.map(({ title }) => title));
  await expect(page.locator('input:visible, textarea:visible, button:visible, nav:visible')).toHaveCount(0);
  for (const selector of [
    '.site-header', '.site-footer', '.skip-link', '.editor-header', '[data-prd-editor]',
    '.editor-status', '.editor-tools', '.editor-outline', '.field-state',
    '.editor-prompt', '.editor-questions',
  ]) {
    await expect(page.locator(`${selector}:visible`), selector).toHaveCount(0);
  }
  const printedValues = page.locator('[data-prd-print-value]');
  expect(await printedValues.allTextContents()).toEqual(values);
  await expect(page.locator('.prd-print :is(input, textarea, button, a, label, [id])')).toHaveCount(0);
  const geometry = await page.locator('.prd-print h1, .prd-print__value').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node);
      return {
        width: node.getBoundingClientRect().width,
        scrollWidth: node.scrollWidth,
        height: node.getBoundingClientRect().height,
        scrollHeight: node.scrollHeight,
        overflow: style.overflow,
        wrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
        maxHeight: style.maxHeight,
        lineHeight: parseFloat(style.lineHeight),
      };
    }),
  );
  for (const [index, node] of geometry.entries()) {
    expect(node.scrollWidth).toBeLessThanOrEqual(Math.ceil(node.width) + 1);
    // Font ink can extend beyond a line box (notably Firefox headings), but must not be clipped.
    expect(node.scrollHeight).toBeLessThanOrEqual(Math.ceil(node.height + node.lineHeight));
    expect(node.overflow).toBe('visible');
    expect(node.wrap).toBe('anywhere');
    expect(node.maxHeight).toBe('none');
    if (index > 0) expect(node.whiteSpace).toBe('pre-wrap');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(A4.width);
  const palette = await page.locator('body').evaluate((body) => {
    const style = getComputedStyle(body);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(palette).toEqual({ color: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' });
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Scrolls every lazy image into view and waits until it has loaded (or failed). */
async function loadImages(page: Page) {
  await page.locator('.doc__body img').evaluateAll(async (nodes) => {
    for (const img of nodes as HTMLImageElement[]) {
      img.scrollIntoView({ behavior: 'instant' });
      if (!img.complete) {
        await new Promise((done) => {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      }
    }
  });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

/** The print-media assertions shared by the four document pages, then a screen-media guard. */
async function expectPrintsCleanly(page: Page, path: string) {
  await page.setViewportSize(A4);
  await page.emulateMedia({ media: 'print' });
  const response = await page.goto(to(path));
  expect(response?.status(), `${path} status`).toBe(200);

  // Content only: no nav, footer, skip link, table of contents or download links.
  await expect(page.locator('nav.site-nav'), `${path} nav`).toBeHidden();
  await expect(page.locator('.site-header'), `${path} header`).toBeHidden();
  await expect(page.locator('.site-footer'), `${path} footer`).toBeHidden();
  await expect(page.locator('a.skip-link'), `${path} skip link`).toBeHidden();
  await expect(page.locator('aside.toc--sidebar'), `${path} TOC sidebar`).toBeHidden();
  await expect(page.locator('details.toc--inline'), `${path} inline TOC`).toBeHidden();
  await expect(page.locator('.toc:visible'), `${path} visible TOC`).toHaveCount(0);
  await expect(page.locator('.doc__actions:visible, .source-card__links:visible'), `${path} actions`).toHaveCount(0);

  await expect(page.locator('main'), `${path} main`).toBeVisible();
  await expect(page.locator('.doc__body'), `${path} body`).toBeVisible();
  await expect(page.locator('h1'), `${path} h1`).toHaveCount(path === '/sample/' ? 2 : 1);
  await expect(page.locator('[data-prd-print], [data-prd-print-template]')).toHaveCount(0);

  // Black on white, 11pt.
  const body = await page.locator('body').evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.color, background: style.backgroundColor, fontSize: style.fontSize };
  });
  expect(body.color, `${path} body color`).toBe('rgb(0, 0, 0)');
  expect(body.background, `${path} body background`).toBe('rgb(255, 255, 255)');
  expect(Math.round(parseFloat(body.fontSize)), `${path} body font-size (11pt)`).toBe(15);

  // Nothing wider than the paper: code wraps, tables shrink, URLs break.
  await loadImages(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(A4.width);

  // Code blocks wrap and print black on light grey with a grey border, never cut off.
  const pres = await page.locator('.doc__body pre').evaluateAll((nodes) =>
    nodes.map((el) => {
      const style = getComputedStyle(el);
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        cutOff: el.scrollWidth > el.clientWidth,
      };
    }),
  );
  for (const pre of pres) {
    expect(pre.whiteSpace, `${path} pre white-space`).toBe('pre-wrap');
    expect(pre.overflowX, `${path} pre overflow`).toBe('visible');
    expect(pre.color, `${path} pre color`).toBe('rgb(0, 0, 0)');
    expect(pre.background, `${path} pre background`).toBe('rgb(244, 244, 244)');
    expect(pre.border, `${path} pre border`).toBe('rgb(153, 153, 153)');
    expect(pre.radius, `${path} pre corners`).toBe('0px');
    expect(pre.cutOff, `${path} pre content cut off`).toBe(false);
  }

  // Links: internal ones are plain text, external ones are followed by their URL. `main` rather
  // than `.doc__body`: the sample's external links sit in its source-card header. Only rendered
  // links count — the hidden TOC and download links keep their screen colours.
  const links = await page.locator('main a[href]').evaluateAll((nodes) =>
    nodes
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({
        href: el.getAttribute('href') ?? '',
        color: getComputedStyle(el).color,
        parentColor: getComputedStyle(el.parentElement as Element).color,
        decoration: getComputedStyle(el).textDecorationLine,
        after: getComputedStyle(el, '::after').content,
      })),
  );
  for (const link of links) {
    // `color: inherit` — the link is the colour of the text around it, never the accent green.
    expect(link.color, `${path} ${link.href} color`).toBe(link.parentColor);
    expect(link.color, `${path} ${link.href} color`).not.toBe('rgb(15, 110, 86)');
    if (link.href.startsWith('http')) {
      // `content: " (" attr(href) ")"` serialises differently per engine: Chromium joins it into one
      // string `"(https://…)"`, WebKit keeps the list `" (" "https://…" ")"`, and Firefox returns the
      // unresolved `" (" attr(href) ")"` (it cannot resolve attr() in computed style). Strip quotes
      // and whitespace and accept the URL or the attr() reference.
      const after = link.after.replace(/["\s]/g, '');
      expect(after, `${path} ${link.href} ::after`).toMatch(new RegExp(`^\\((${escapeRegExp(link.href)}|attr\\(href\\))\\)$`));
    } else {
      expect(link.decoration, `${path} ${link.href} decoration`).toBe('none');
      expect(link.after, `${path} ${link.href} ::after`).toBe('none');
    }
  }

  // Screen rendering is untouched: the chrome comes back and the palette is the site's own.
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('nav.site-nav'), `${path} nav on screen`).toBeVisible();
  await expect(page.locator('.site-footer'), `${path} footer on screen`).toBeVisible();
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).color), `${path} screen color`).not.toBe(
    'rgb(0, 0, 0)',
  );
  await page.emulateMedia({ media: 'print' });

  return { pres: pres.length, links: links.length, external: links.filter((l) => l.href.startsWith('http')).length };
}

test('/guide/ prints content only in black on white', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/guide/');
  expect(counts.links, 'links checked').toBeGreaterThan(0);
});

test('/walkthrough/ prints content only in black on white', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/walkthrough/');
  expect(counts.links, 'links checked').toBeGreaterThan(0);
});

test('/template/ prints content only in black on white, without the download button', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/template/');
  expect(counts.pres, 'code blocks checked').toBeGreaterThan(0);
  await expect(page.locator('.doc__actions a.button')).toBeHidden();
});

test('/sample/ prints content only with its seven screenshots', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/sample/');
  expect(counts.pres, 'code blocks checked').toBeGreaterThan(0);
  expect(counts.external, 'external links checked').toBeGreaterThan(0);

  const images = page.locator('.doc__body figure img');
  await expect(images).toHaveCount(7);
  for (let i = 0; i < 7; i += 1) {
    await expect(images.nth(i), `screenshot ${i + 1}`).toBeVisible();
  }
  const sizes = await images.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((img) => ({
      naturalWidth: img.naturalWidth,
      width: img.getBoundingClientRect().width,
      radius: getComputedStyle(img).borderTopLeftRadius,
    })),
  );
  for (const img of sizes) {
    expect(img.naturalWidth, 'screenshot loaded').toBeGreaterThan(0);
    expect(img.width, 'screenshot fits the paper').toBeLessThanOrEqual(A4.width);
    expect(img.radius, 'screenshot corners').toBe('0px');
  }
});

for (const path of ['/', '/create/']) {
  test(`${path} prints wrapping live text and returns to the unchanged screen editor`, async ({ page }) => {
    await page.setViewportSize(A4);
    await page.goto(to(path));
    await populatePrintFixture(page);
    await expect(page.locator('[data-prd-print]')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create a product requirements document');
    const first = page.locator('.editor-section textarea').first();
    await first.evaluate((node: HTMLTextAreaElement) => {
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      node.focus({ preventScroll: true });
      node.setSelectionRange(15, 35);
    });
    const before = await editorScreenState(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.emulateMedia({ media: 'print' });
      await expectPrintDocument(page, LONG_TITLE, PRINT_VALUES);
      await page.emulateMedia({ media: 'screen' });
      await expect(page.locator('[data-prd-print]')).toBeHidden();
      // Firefox may apply screen CSS before delivering the media-change event.
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(first).toBeFocused();
      expect(await editorScreenState(page)).toEqual(before);
      await expect(first).toBeEditable();
    }
    expect(requests, 'printing does not transmit draft data or fetch resources').toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.locator('#copy-section-context-problem')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.editor-section textarea').nth(1)).toBeFocused();
    await page.locator('.editor-outline a').last().click();
    await expect(page.locator('.editor-section textarea').last()).toBeFocused();
  });

  test(`${path} reprints unsaved edits, restores on print-first navigation, and clears stale text`, async ({ page }) => {
    await page.setViewportSize(A4);
    await page.goto(to(path));
    await populatePrintFixture(page);
    await page.locator('#save-draft').click();
    await page.emulateMedia({ media: 'print' });
    await expectPrintDocument(page, LONG_TITLE, PRINT_VALUES);
    await page.emulateMedia({ media: 'screen' });

    const newestTitle = 'Newest unsaved title';
    const newestValue = 'Newest unsaved answer\n<em>Literal text, not markup</em>\nLATEST-ANSWER-END';
    await page.locator('#document-title').evaluate((node: HTMLInputElement, value) => { node.value = value; }, newestTitle);
    await page.locator('.editor-section textarea').first().evaluate(
      (node: HTMLTextAreaElement, value) => { node.value = value; }, newestValue,
    );
    // beforeprint is independent of matchMedia; Chromium's native PDF path also exercises it below.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    expect(await page.locator('[data-prd-print-title]').textContent()).toBe(newestTitle);
    expect(await page.locator('[data-prd-print-value]').first().textContent()).toBe(newestValue);
    await expect(page.locator('.prd-print em')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('.prd-print h1')).toHaveCount(0);
    await page.emulateMedia({ media: 'print' });
    await expectPrintDocument(page, newestTitle, [newestValue, ...PRINT_VALUES.slice(1)]);

    await page.reload();
    await expect(page.locator('#save-status')).toContainText('Draft restored');
    await expect(page.locator('#document-title')).toHaveValue(newestTitle);
    await expect(page.locator('.editor-section textarea').first()).toHaveValue(newestValue);
    const restored = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
      PRD_EDITOR_STORAGE_KEY,
    );
    expect(restored).toMatchObject({
      version: 1,
      state: {
        title: newestTitle,
        values: {
          [PRD_TEMPLATE.sections[0]!.id]: newestValue,
        },
      },
    });
    await expectPrintDocument(page, newestTitle, [newestValue, ...PRINT_VALUES.slice(1)]);
    await page.emulateMedia({ media: 'screen' });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#start-over').click();
    await page.emulateMedia({ media: 'print' });
    await expectPrintDocument(page, '', PRD_TEMPLATE.sections.map(() => ''));
    await page.emulateMedia({ media: 'screen' });
    await page.locator('#document-title').fill('   ');
    await page.emulateMedia({ media: 'print' });
    await expectPrintDocument(page, '   ', PRD_TEMPLATE.sections.map(() => ''));
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('#document-title')).toHaveValue('   ');
  });

  test(`${path} prints a complete populated browser PDF`, async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only in Playwright');
    await page.setViewportSize(A4);
    await page.goto(to(path));
    await populatePrintFixture(page);
    await page.locator('.editor-section textarea').first().focus();
    const before = await editorScreenState(page);
    const pdf = await page.pdf({ path: testInfo.outputPath('complete-prd.pdf'), format: 'A4' });
    expect(await editorScreenState(page)).toEqual(before);
    const rendered = await readPrintedPdf(pdf);
    const text = compact(rendered.text);
    const markers = [
      normalizePrdTitle(LONG_TITLE),
      ...ANSWER_LINES,
      LONG_URL,
      UNICODE_SENTENCE,
      ...PRD_TEMPLATE.sections.slice(1).map((_, index) => `SECTION-${index + 2}-FINAL`),
    ];
    console.log(`${path} browser PDF: ${rendered.pages} pages; answer markers present: ${
      ANSWER_LINES.filter((line) => text.includes(compact(line))).length
    }/80; full title: ${text.includes(compact(normalizePrdTitle(LONG_TITLE)))}; Unicode: ${
      text.includes(compact(UNICODE_SENTENCE))
    }; final section: ${text.includes('SECTION-12-FINAL')}`);
    expect(rendered.pages).toBeGreaterThanOrEqual(2);
    let previous = -1;
    for (const marker of markers) {
      const position = text.indexOf(compact(marker));
      expect(position, `rendered PDF contains ${marker}`).toBeGreaterThan(previous);
      previous = position;
    }
    for (const label of [
      'Optional', 'Create a product requirements document', 'Download your PRD',
      'Document outline', 'Your draft stays in this browser', ...PRD_TEMPLATE.sections.map(({ prompt }) => prompt),
    ]) {
      expect(text).not.toContain(compact(label));
    }

    await page.locator('#document-title').evaluate((node: HTMLInputElement) => { node.value = 'Reprinted unsaved title'; });
    await page.locator('.editor-section textarea').first().evaluate((node: HTMLTextAreaElement) => {
      node.value = 'A new unsaved answer.\nREPRINT-FINAL';
    });
    const reprinted = await readPrintedPdf(await page.pdf({ format: 'A4' }));
    expect(compact(reprinted.text)).toContain('Reprintedunsavedtitle');
    expect(compact(reprinted.text)).toContain('REPRINT-FINAL');
    expect(compact(reprinted.text)).not.toContain('ANSWER-080');
    expect(compact(reprinted.text)).not.toContain('LONG-TITLE-END');
  });
}

// Last on purpose: saves the sample PRD as an A4 PDF under test-results/ (ignored, never committed) and
// reports its page count and size as evidence. `page.pdf()` exists in Chromium headless only, so the
// CSS assertions above run in every engine and only this half skips elsewhere.
test('/sample/ saves as an A4 PDF', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only in Playwright');
  await page.setViewportSize(A4);
  await page.emulateMedia({ media: 'print' });
  await page.goto(to('/sample/'));
  await loadImages(page);

  const dir = resolve('test-results');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'sample.pdf');
  const pdf = await page.pdf({ path, format: 'A4', printBackground: true });

  // Chromium writes its page tree uncompressed: count `/Type /Page` objects (not `/Pages`) and
  // cross-check against the page tree's root `/Count` (the largest; Skia nests intermediate nodes).
  const text = pdf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const count = Math.max(
    0,
    ...Array.from(text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g), (m) => Number(m[1])),
  );
  const message = `sample.pdf: ${pages} A4 pages (page tree /Count ${count}), ${pdf.length} bytes at ${path}`;
  console.log(message);
  testInfo.annotations.push({ type: 'pdf', description: message });

  expect(pdf.length).toBeGreaterThan(10_000);
  expect(count, 'page tree count matches page objects').toBe(pages);
  expect(pages, 'page count').toBeGreaterThanOrEqual(5);
  expect(pages, 'page count').toBeLessThanOrEqual(40);
});
