import { expect, test, type Locator, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// One skeleton code block per PRD section in content/template.md; the first sits under
// "## Mission and stop condition", the page's first h2.
const BLOCKS = 14;
const FIRST_SECTION = 'Mission and stop condition';

// The clipboard API is permission-gated in Chromium; readText() in the page checks the result.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** The clipboard text with LF line endings: the Windows clipboard stores text as CRLF. */
const readClipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

/** What the button should copy: the block's code text with one trailing newline stripped. */
const skeletonText = (pre: Locator) =>
  pre.evaluate((el) => (el.querySelector('code') ?? el).textContent?.replace(/\n$/, '') ?? '');

test('/template/ gives each of the 14 skeleton blocks a Copy button named after its section', async ({ page }) => {
  await page.goto(to('/template/'));

  await expect(page.locator('main .prose pre')).toHaveCount(BLOCKS);
  const buttons = page.locator('button.copy-button');
  await expect(buttons).toHaveCount(BLOCKS);

  const labels = await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  for (const label of labels) expect(label).toMatch(/^Copy the .+ skeleton$/);
  expect(labels[0]).toBe(`Copy the ${FIRST_SECTION} skeleton`);
  expect(new Set(labels).size, 'every button names a different section').toBe(BLOCKS);

  // Keyboard order: the button comes right before the code it copies, inside one wrapper.
  const order = await page.locator('.code-block').evaluateAll((nodes) =>
    nodes.map((node) => Array.from(node.children, (child) => child.tagName).join('>')),
  );
  expect(order).toEqual(Array(BLOCKS).fill('BUTTON>PRE'));
  await expect(buttons.first()).toHaveText('Copy');
  await expect(buttons.first()).toHaveAttribute('type', 'button');
});

test('clicking Copy puts the block text on the clipboard, says Copied, then resets', async ({ page }) => {
  await page.goto(to('/template/'));

  const button = page.locator('button.copy-button').first();
  const expected = await skeletonText(page.locator('main .prose pre').first());
  expect(expected.startsWith('Build the complete {Product Name} application'), 'first skeleton text').toBe(true);

  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 500 });
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(button).toHaveAttribute('aria-label', `Copy the ${FIRST_SECTION} skeleton`);

  const clipboard = await readClipboard(page);
  expect(clipboard).toBe(expected);
  expect(clipboard.endsWith('\n'), 'trailing newline stripped').toBe(false);

  const status = page.locator('main .copy-status[role="status"]');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText(`Copied the ${FIRST_SECTION} skeleton`);

  await expect(button).toHaveText('Copy', { timeout: 2000 });
  await expect(button).not.toHaveAttribute('data-state');
});

test('Copy works from the keyboard: focus, Enter', async ({ page }) => {
  await page.goto(to('/template/'));

  const button = page.locator('button.copy-button').first();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Copied', { timeout: 500 });
  expect(await readClipboard(page)).toMatch(/^Build the complete \{Product Name\}/);
});

test('every block copies its own text (the last one is the multi-line Completion skeleton)', async ({ page }) => {
  await page.goto(to('/template/'));

  const last = page.locator('button.copy-button').last();
  await expect(last).toHaveAttribute('aria-label', 'Copy the Completion skeleton');
  const expected = await skeletonText(page.locator('main .prose pre').last());
  expect(expected.split('\n').length, 'the Completion skeleton spans several lines').toBeGreaterThan(5);

  await last.click();
  await expect(last).toHaveText('Copied', { timeout: 500 });
  expect(await readClipboard(page)).toBe(expected);
  await expect(page.locator('main .copy-status')).toHaveText('Copied the Completion skeleton');
});

test('the other pages ship no Copy buttons and no script beyond the nav helper', async ({ page }) => {
  for (const path of ['/', '/sample/', '/guide/', '/walkthrough/']) {
    await page.goto(to(path));
    await expect(page.locator('button.copy-button'), `${path} copy buttons`).toHaveCount(0);
    // /sample/ ships its own page-scoped "Copy the PRD" script (tests/e2e/sample.spec.ts covers it); every
    // page carries the inline phone-nav helper, `script[data-nav]` (tests/e2e/site.spec.ts covers it).
    if (path !== '/sample/') await expect(page.locator('script:not([data-nav])'), `${path} script elements`).toHaveCount(0);
  }
});

test('the buttons do not widen /template/ at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(to('/template/'));
  await expect(page.locator('button.copy-button')).toHaveCount(BLOCKS);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});

test('on a phone every Copy button is thumb-sized (>= 32 px tall) and stays clear of the code', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(to('/template/'));
  const buttons = page.locator('button.copy-button');
  await expect(buttons).toHaveCount(BLOCKS);

  const rects = await buttons.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { width, height } = node.getBoundingClientRect();
      return { width, height };
    }),
  );
  for (const [i, rect] of rects.entries()) {
    expect(rect.height, `button ${i + 1} height`).toBeGreaterThanOrEqual(32);
    expect(rect.width, `button ${i + 1} width`).toBeGreaterThanOrEqual(32);
  }

  // The first block's button sits in the pre's right padding, not over any glyph of its code.
  const overlaps = await page.locator('.code-block').first().evaluate((block) => {
    const button = block.querySelector('button')!.getBoundingClientRect();
    const code = block.querySelector('pre code') ?? block.querySelector('pre')!;
    const range = document.createRange();
    range.selectNodeContents(code);
    return Array.from(range.getClientRects()).some(
      (glyphs) =>
        glyphs.width > 0 &&
        glyphs.left < button.right &&
        glyphs.right > button.left &&
        glyphs.top < button.bottom &&
        glyphs.bottom > button.top,
    );
  });
  expect(overlaps, 'first Copy button overlaps its code').toBe(false);
});
