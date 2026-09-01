import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// The gist snapshot the button copies, byte-verbatim (CRLF) and served under the base as-is.
const RAW = 'public/raw/build-the-urlist.md';
const RESET = 'Copy the PRD';
const FAILED = 'Copy failed — use Download .md';

// The clipboard API is permission-gated in Chromium; readText() in the page checks the result.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

/** LF line endings on both sides: the file is CRLF and the Windows clipboard rewrites newlines. */
const normalise = (text: string) => text.replace(/\r\n/g, '\n');
const readClipboard = async (page: Page) => normalise(await page.evaluate(() => navigator.clipboard.readText()));

const copyButton = (page: Page) => page.locator('button.copy-prd');
const statusRegion = (page: Page) => page.locator('.source-card .copy-prd-status[role="status"]');

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

  await button.click();
  await expect(button).toHaveText('Copied', { timeout: 3000 });
  await expect(button).toHaveAttribute('data-state', 'copied');
  await expect(button).not.toHaveAttribute('aria-busy');

  const expected = normalise(readFileSync(RAW, 'utf8'));
  expect(expected.length, 'the gist is a long document').toBeGreaterThan(20_000);
  const clipboard = await readClipboard(page);
  expect(clipboard.length, 'clipboard length').toBe(expected.length);
  expect(clipboard).toBe(expected);

  const status = statusRegion(page);
  await expect(status).toHaveText(/^Copied the PRD \(\d+\.\d KB\)$/);
  test.info().annotations.push({ type: 'status text', description: (await status.textContent()) ?? '' });

  await expect(button).toHaveText(RESET, { timeout: 2500 });
  await expect(button).not.toHaveAttribute('data-state');
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

  await expect(button).toHaveText(RESET, { timeout: 4000 });
});

test('/sample/ ships exactly one script and no template Copy buttons; /guide/ and /walkthrough/ ship none', async ({ page }) => {
  await page.goto(to('/sample/'));
  await expect(page.locator('script')).toHaveCount(1);
  await expect(page.locator('button.copy-button')).toHaveCount(0);

  for (const path of ['/guide/', '/walkthrough/']) {
    await page.goto(to(path));
    await expect(page.locator('script'), `${path} script elements`).toHaveCount(0);
  }
});

test('the button does not widen /sample/ at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(to('/sample/'));
  await expect(copyButton(page)).toHaveCount(1);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});
