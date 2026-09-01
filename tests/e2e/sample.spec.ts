import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// The gist snapshot the button copies, byte-verbatim (CRLF) and served under the base as-is.
const RAW = 'public/raw/build-the-urlist.md';
const RESET = 'Copy the PRD';
const FAILED = 'Copy failed — use Download .md';
// sample.astro resets the label on fixed timers (1500 ms after Copied, 3000 ms after a failure). The
// ceiling is generous on purpose: `expect` polls and returns as soon as the label changes, so a passing
// run pays nothing, while a CPU-loaded local run can delay the 3 s timer past a 4 s ceiling.
const RESET_TIMEOUT = 15_000;

// The clipboard API is permission-gated in Chromium; readText() in the page checks the result.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** LF line endings on both sides: the file is CRLF and the Windows clipboard rewrites newlines. */
const normalise = (text: string) => text.replace(/\r\n/g, '\n');
const readClipboard = async (page: Page) => normalise(await page.evaluate(() => navigator.clipboard.readText()));

const copyButton = (page: Page) => page.locator('button.copy-prd');
const statusRegion = (page: Page) => page.locator('.source-card .copy-prd-status[role="status"]');
const evolvedLink = (page: Page) => page.locator('.source-card__links a', { hasText: 'How it evolved' });
// Phone tap targets: every control in the card is at least this tall (task #1435).
const MIN_TAP = 32;

/** The neighbour's left edge: it must not move while the button's label is shorter than at rest. */
const leftOf = (locator: Locator) => locator.evaluate((el) => el.getBoundingClientRect().left);

test('/sample/ adds Copy the PRD as the third action, after Download .md, and keeps its three links', async ({ page }) => {
  await page.goto(to('/sample/'));

  const button = copyButton(page);
  await expect(button).toHaveCount(1);
  await expect(button).toHaveText(RESET);
  await expect(button).toHaveAttribute('type', 'button');

  const items = page.locator('.source-card__links > li');
  await expect(items).toHaveText(['View on GitHub', 'Download .md', RESET, 'How it evolved']);
  await expect(items.nth(2).locator('button.copy-prd')).toHaveCount(1);
  await expect(page.locator('.source-card__links a')).toHaveCount(3);

  const status = statusRegion(page);
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText('');
});

test('clicking Copy the PRD puts the whole gist on the clipboard, says Copied, then resets', async ({ page }) => {
  await page.goto(to('/sample/'));
  const button = copyButton(page);
  const neighbour = evolvedLink(page);
  const restingLeft = await leftOf(neighbour);

  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 3000 });
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(button).not.toHaveAttribute('aria-busy');
  // The button keeps its resting width while it says Copied, so How it evolved does not slide over.
  expect(await leftOf(neighbour), 'How it evolved left while Copied').toBe(restingLeft);

  const expected = normalise(readFileSync(RAW, 'utf8'));
  expect(expected.length, 'the gist is a long document').toBeGreaterThan(20_000);
  const clipboard = await readClipboard(page);
  expect(clipboard.length, 'clipboard length').toBe(expected.length);
  expect(clipboard).toBe(expected);

  const status = statusRegion(page);
  await expect(status).toHaveText(/^Copied the PRD \(\d+\.\d KB\)$/);
  test.info().annotations.push({ type: 'status text', description: (await status.textContent()) ?? '' });

  await expect(button).toHaveText(RESET, { timeout: RESET_TIMEOUT });
  await expect(button).not.toHaveAttribute('data-state');
  expect(await leftOf(neighbour), 'How it evolved left after the reset').toBe(restingLeft);
});

test('Copy the PRD works from the keyboard: focus, Enter', async ({ page }) => {
  await page.goto(to('/sample/'));
  const button = copyButton(page);

  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button).toHaveText('Copied', { timeout: 3000 });
  expect(await readClipboard(page)).toMatch(/^# Build The Urlist\n/);
});

test('when the gist cannot be fetched the button says so and leaves Download .md as the way out', async ({ page }) => {
  await page.goto(to('/sample/'));
  await page.route('**/raw/build-the-urlist.md', (route) => route.fulfill({ status: 500 }));
  const button = copyButton(page);

  await button.click();
  await expect(button).toHaveText(FAILED, { timeout: 3000 });
  await expect(button).not.toHaveAttribute('data-state');
  await expect(button).not.toHaveAttribute('aria-busy');
  await expect(button).toBeFocused();
  await expect(statusRegion(page)).toHaveText(FAILED);
  await expect(page.locator('.source-card__links a[download]')).toHaveText('Download .md');

  await expect(button).toHaveText(RESET, { timeout: RESET_TIMEOUT });
});

test('/sample/ ships exactly one script beyond the nav helper and no template Copy buttons; /guide/ and /walkthrough/ ship none', async ({ page }) => {
  // `script[data-nav]` is the inline phone-nav helper every page carries (tests/e2e/site.spec.ts covers it).
  await page.goto(to('/sample/'));
  await expect(page.locator('script:not([data-nav])')).toHaveCount(1);
  await expect(page.locator('button.copy-button')).toHaveCount(0);

  for (const path of ['/guide/', '/walkthrough/']) {
    await page.goto(to(path));
    await expect(page.locator('script:not([data-nav])'), `${path} script elements`).toHaveCount(0);
  }
});

test('the button does not widen /sample/ at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(to('/sample/'));
  await expect(copyButton(page)).toHaveCount(1);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});

test('on a phone the four card controls are thumb-sized (>= 32 px tall) and the card is no taller for it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(to('/sample/'));
  await expect(copyButton(page)).toHaveCount(1);

  const controls = page.locator('.source-card__links a, .source-card__links button.copy-prd');
  await expect(controls).toHaveCount(4);
  const rects = await controls.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { width, height } = node.getBoundingClientRect();
      return { text: node.textContent?.trim() ?? '', width, height };
    }),
  );
  for (const rect of rects) {
    expect(rect.height, `${rect.text} height`).toBeGreaterThanOrEqual(MIN_TAP);
    expect(rect.width, `${rect.text} width`).toBeGreaterThanOrEqual(MIN_TAP);
  }

  // The hit area comes from padding cancelled by a negative margin: each row is still one line tall.
  const rowHeights = await page
    .locator('.source-card__links > li')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  const lineHeight = await page.locator('.source-card__links').evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  for (const height of rowHeights) expect(height, 'row height').toBeLessThanOrEqual(lineHeight + 0.5);
});
