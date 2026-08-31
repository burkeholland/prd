import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// The site is published under this base path (astro.config.mjs); see tests/e2e/site.spec.ts.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// One page per gist revision at /history/<n>/, built from content/gist/history.json. The count
// and the revision numbers come from the file; 1, 3 and 13 are facts about the snapshots
// (first draft, the big cut, the LF → CRLF flip that GitHub counts as every line changed).
const HISTORY = resolve('content/gist/history.json');
const history = existsSync(HISTORY)
  ? (JSON.parse(readFileSync(HISTORY, 'utf8')) as { count: number; revisions: { n: number; version: string }[] })
  : null;
const count = history?.count ?? 0;

// Hand-written sentence per revision, keyed by the commit sha (content/gist/history-notes.json).
const NOTES = resolve('content/gist/history-notes.json');
const notes = existsSync(NOTES)
  ? (JSON.parse(readFileSync(NOTES, 'utf8')) as { notes: Record<string, string> }).notes
  : {};
const noteFor = (n: number) => notes[history?.revisions.find((rev) => rev.n === n)?.version ?? ''];

test.skip(history === null, 'gist history not merged yet');

test('revision 1 is the first draft: a preview, not a diff', async ({ page }) => {
  const response = await page.goto(to('/history/1/'));
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText(`Revision 1 of ${count}`);
  await expect(page.locator('table.diff')).toHaveCount(0);
  await expect(page.locator('pre')).toHaveCount(1);
  await expect(page.locator('h2')).toContainText('First draft');
  await expect(page.locator('a', { hasText: 'Previous' })).toHaveCount(0);
  await expect(page.locator('a', { hasText: 'Next' })).toHaveAttribute('href', to('/history/2/'));
});

test('revision 13 shows one diff table, hunks, the line-ending note and is noindex', async ({ page }) => {
  test.skip(count < 13, 'fewer than 13 revisions');
  await page.goto(to('/history/13/'));
  await expect(page.locator('h1')).toHaveText(`Revision 13 of ${count}`);

  await expect(page.locator('table.diff')).toHaveCount(1);
  expect(await page.locator('tr.diff__hunk').count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('p.note')).toContainText('line endings');
  await expect(page.locator('p.summary')).toContainText('lines of text vs revision 12');

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

  await expect(page.locator('a', { hasText: 'Previous' })).toHaveAttribute('href', to('/history/12/'));
  await expect(page.locator('a', { hasText: 'Next' })).toHaveAttribute('href', to('/history/14/'));
  await expect(page.locator('a', { hasText: 'All revisions' })).toHaveAttribute('href', to('/history/'));
  await expect(page.locator('a', { hasText: 'View on GitHub' })).toHaveAttribute('href', /^https:\/\/gist\.github\.com\//);
});

test('the last revision carries the badge that links to the sample page', async ({ page }) => {
  await page.goto(to(`/history/${count}/`));
  const badge = page.locator('mark');
  await expect(badge).toHaveCount(1);
  await expect(badge.locator('a')).toHaveAttribute('href', to('/sample/'));
  await expect(page.locator('a', { hasText: 'Next' })).toHaveCount(0);
});

test('every revision page responds 200 and ships no script', async ({ page, request }) => {
  for (let n = 1; n <= count; n++) {
    const response = await request.get(to(`/history/${n}/`));
    expect(response.status(), `/history/${n}/ status`).toBe(200);
  }
  for (const n of [1, 3, 13].filter((n) => n <= count)) {
    await page.goto(to(`/history/${n}/`));
    expect(await page.evaluate(() => document.querySelectorAll('script').length), `/history/${n}/ scripts`).toBe(0);
  }
});

test('the biggest diff wraps without horizontal scroll at 320px', async ({ page }) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(to('/history/3/'));
  await expect(page.locator('table.diff')).toHaveCount(1);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(320);
});

test('the sitemap lists no revision page', async ({ request }) => {
  const response = await request.get(to('/sitemap-0.xml'));
  expect(response.status()).toBe(200);
  const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
  expect(locs.length).toBeGreaterThan(0);
  expect(locs.filter((loc) => /\/history\/\d+\/?$/.test(loc)), 'revision pages in the sitemap').toEqual([]);
});

test('revision 3 leads with its hand-written note, and the nav marks "How it evolved" current', async ({ page }) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  const note = noteFor(3);
  expect(note, 'a note for revision 3 in history-notes.json').toBeTruthy();

  await page.goto(to('/history/3/'));
  const lede = page.locator('p.lede');
  await expect(lede).toHaveCount(1);
  await expect(lede).toHaveText(note!);
  // The lede sits between the heading and the meta line.
  await expect(page.locator('.revision__header > :nth-child(2)')).toHaveClass(/\blede\b/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', note!);

  // Only the section's item is current; the prefix rule must not light Home too.
  const current = page.locator('nav.site-nav a[aria-current="page"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText('How it evolved');
  await expect(current).toHaveAttribute('href', to('/history/'));
});

test('the history table links every row to its diff page and keeps the + and − columns in place', async ({ page }) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  await page.goto(to('/history/'));
  const table = page.locator('table.history');

  // The revision number is the link to the diff page.
  const row3 = table.locator('tbody tr').nth(2);
  await expect(row3.locator('th[scope="row"] a')).toHaveAttribute('href', to('/history/3/'));
  await expect(row3.locator('th[scope="row"] a')).toHaveAttribute('aria-label', 'Revision 3: what changed');
  await expect(table.locator('tbody th[scope="row"] a')).toHaveCount(count);

  // The View cell: one "Diff" link (distinct name per row) and still exactly one gist link.
  const diffs = table.locator('tbody a[aria-label^="Diff of revision "]');
  await expect(diffs).toHaveCount(count);
  await expect(diffs.nth(2)).toHaveText('Diff');
  await expect(diffs.nth(2)).toHaveAttribute('href', to('/history/3/'));
  await expect(diffs.nth(2)).toHaveAttribute('aria-label', 'Diff of revision 3');
  await expect(table.locator('tbody a[href^="https://gist.github.com/"]')).toHaveCount(count);

  // site.spec.ts reads `+` and `−` by td index; the new links live in the th and the last td.
  const cells = await row3.locator('td').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
  expect(cells[1], 'row 3 `+` cell').toMatch(/^\d+$/);
  expect(cells[2], 'row 3 `−` cell').toMatch(/^\d+$/);

  // The note sits under the section summary in "What changed".
  const note = noteFor(3);
  await expect(row3.locator('td.history__delta p.history__note')).toHaveText(note!);
  await expect(table.locator('tbody p.history__note')).toHaveCount(
    history!.revisions.filter((rev) => notes[rev.version] !== undefined).length,
  );
});
