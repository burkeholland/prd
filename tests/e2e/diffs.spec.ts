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
  // Both navs: one under the header, one after the first-draft section.
  const navs = page.locator('nav.revision__nav');
  await expect(navs).toHaveCount(2);
  await expect(page.locator('.revision__header nav.revision__nav')).toHaveCount(1);
  await expect(page.locator('section.revision__first + nav.revision__nav')).toHaveCount(1);
  for (const nav of [navs.first(), navs.last()]) {
    await expect(nav.locator('a', { hasText: 'Next' })).toHaveAttribute('href', to('/history/2/'));
    await expect(nav.locator('a')).toHaveText(['All revisions', 'Next']);
  }
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

  // Previous / All revisions / Next are a list rendered twice — under the header and after the diff —
  // with the same hrefs in each; "View on GitHub" stays in the meta line.
  const navs = page.locator('nav.revision__nav');
  await expect(navs).toHaveCount(2);
  for (const nav of [navs.first(), navs.last()]) {
    await expect(nav.locator('a', { hasText: 'Previous' })).toHaveAttribute('href', to('/history/12/'));
    await expect(nav.locator('a', { hasText: 'Next' })).toHaveAttribute('href', to('/history/14/'));
    await expect(nav.locator('a', { hasText: 'All revisions' })).toHaveAttribute('href', to('/history/'));
    await expect(nav.locator('a')).toHaveText(['Previous', 'All revisions', 'Next']);
  }
  await expect(page.locator('p.meta a', { hasText: 'View on GitHub' })).toHaveAttribute('href', /^https:\/\/gist\.github\.com\//);
  await expect(page.locator('p.meta a', { hasText: 'Previous' })).toHaveCount(0);
});

test('the last revision carries the badge that links to the sample page', async ({ page }) => {
  await page.goto(to(`/history/${count}/`));
  const badge = page.locator('mark');
  await expect(badge).toHaveCount(1);
  await expect(badge.locator('a')).toHaveAttribute('href', to('/sample/'));
  // 0.85rem at the 17 px root: the last sub-14 px text on the diff pages was this badge (13.6 px).
  await expect(badge).toHaveCSS('font-size', '14.45px');
  const navs = page.locator('nav.revision__nav');
  await expect(navs).toHaveCount(2);
  await expect(navs.first().locator('a', { hasText: 'Next' })).toHaveCount(0);
  await expect(navs.last().locator('a', { hasText: 'Next' })).toHaveCount(0);
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

// The meta line as rects, for the hit-area tests: the paragraph, its line-height, the `time`'s glyphs,
// the badge and every link — the link's box (its hit area) beside the Range rect of its text (the
// glyphs the box grew around), plus whether five taps on those glyphs all land on that link: the
// centre, 1 px inside the top and bottom edges, 3 px inside the left and right ones (Chromium lets the
// space after a link claim about a pixel of its last glyph). Passed to page.evaluate, so it must not
// reach outside itself.
function metaGeometry() {
  const plain = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const box = (el: Element) => plain(el.getBoundingClientRect());
  const glyphs = (el: Element) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return plain(range.getBoundingClientRect());
  };
  const meta = document.querySelector('p.meta')!;
  const badge = document.querySelector('p.meta .badge');
  const links = Array.from(meta.querySelectorAll('a'), (a) => {
    const text = glyphs(a);
    const probes: [number, number][] = [
      [text.left + text.width / 2, text.top + text.height / 2],
      [text.left + text.width / 2, text.top + 1],
      [text.left + text.width / 2, text.bottom - 1],
      [text.left + 3, text.top + text.height / 2],
      [text.right - 3, text.top + text.height / 2],
    ];
    return {
      label: a.textContent?.trim() ?? '',
      box: box(a),
      text,
      tapsHit: probes.every(([x, y]) => document.elementFromPoint(x, y)?.closest('a') === a),
    };
  });
  return {
    scrollWidth: document.documentElement.scrollWidth,
    meta: box(meta),
    lineHeight: parseFloat(getComputedStyle(meta).lineHeight),
    time: glyphs(meta.querySelector('time')!),
    badge: badge ? box(badge) : null,
    links,
    navTop: document.querySelector('nav.revision__nav')!.getBoundingClientRect().top,
  };
}
type Rect = ReturnType<typeof metaGeometry>['meta'];
type MetaLink = ReturnType<typeof metaGeometry>['links'][number];
const middle = (r: Rect) => r.top + r.height / 2;
const intersects = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// The hit-area padding is cancelled by its negative margin, so the paragraph is still an exact
// number of line boxes tall — however many lines the reader's font needs (CI's DejaVu Sans is ≈ 8 %
// wider than Segoe UI and wraps the badged meta line at 768 px; Windows does not).
const expectWholeLines = (meta: ReturnType<typeof metaGeometry>, label: string) => {
  const lines = meta.meta.height / meta.lineHeight;
  expect(lines, `${label}: p.meta is a whole number of line boxes`).toBeCloseTo(Math.round(lines), 1);
  expect(Math.round(lines), `${label}: at least one line`).toBeGreaterThanOrEqual(1);
};

// "View on GitHub" and the badge link sharing the meta line: side by side (their glyph rects overlap
// vertically) the two grown hit rects must not intersect. Stacked — a wider font pushes the badge onto
// the next line — they sit on the line pitch, where two ≥ 32 px rects cannot help meeting in the gap
// between the lines: then the badge's rect must at least start below the "View on GitHub" glyphs (the
// taps-hit checks prove a tap on either link's text still lands on that link).
const expectCoexist = (gh: MetaLink, sample: MetaLink, label: string) => {
  const sameLine = gh.text.top < sample.text.bottom && sample.text.top < gh.text.bottom;
  if (sameLine) {
    expect(intersects(gh.box, sample.box), `${label}: hit rects on one line must not intersect`).toBe(false);
  } else {
    expect(sample.box.top, `${label}: stacked, badge hit rect below the "View on GitHub" glyphs`).toBeGreaterThan(gh.text.bottom - 1);
  }
};

test('at 390px the diff drops the line numbers for a ≥ 320 px text column, and a tappable nav follows the table', async ({
  page,
}) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(to('/history/3/'));
  const table = page.locator('table.diff');
  await expect(table).toHaveCount(1);

  // The two line-number columns are gone (header and body); the text cell has the room (was 229 px).
  await expect(table.locator('thead th').nth(0)).toBeHidden();
  await expect(table.locator('thead th').nth(1)).toBeHidden();
  await expect(table.locator('thead th').nth(3)).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rect = (el: Element | null) => el?.getBoundingClientRect() ?? null;
    const table = document.querySelector('table.diff')!;
    const scroll = document.querySelector<HTMLElement>('.table-scroll')!;
    const navs = Array.from(document.querySelectorAll('nav.revision__nav'));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      textCell: rect(document.querySelector('tbody tr:not(.diff__hunk) td:nth-child(4)'))!.width,
      hunkCell: rect(document.querySelector('tr.diff__hunk td[colspan="4"]'))!.width,
      tableWidth: rect(table)!.width,
      tableScroll: { scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth },
      navCount: navs.length,
      lastNavTop: rect(navs[navs.length - 1] ?? null)?.top ?? NaN,
      tableBottom: rect(table)!.bottom,
      linkHeights: Array.from(document.querySelectorAll('nav.revision__nav a'), (a) => a.getBoundingClientRect().height),
    };
  });
  expect(geometry.scrollWidth, 'page scrollWidth').toBe(390);
  expect(geometry.textCell, 'text cell width').toBeGreaterThanOrEqual(320);
  // The hunk header (colspan=4) still spans the visible columns.
  expect(geometry.hunkCell, 'hunk header width').toBeGreaterThanOrEqual(geometry.tableWidth - 2);
  expect(geometry.tableScroll.scrollWidth, '.table-scroll does not scroll').toBe(geometry.tableScroll.clientWidth);

  // Previous · All revisions · Next: once under the header, once after the diff, every item ≥ 32 px tall.
  expect(geometry.navCount).toBe(2);
  expect(geometry.lastNavTop, 'second nav below the table').toBeGreaterThan(geometry.tableBottom);
  expect(geometry.linkHeights.length).toBe(6);
  for (const height of geometry.linkHeights) expect(height, 'nav link tap target').toBeGreaterThanOrEqual(32);

  // The meta line wraps here (2 lines / 54.91 px on Windows at 390: 2 × 1.7 × 16.15) and keeps its
  // whole-line height; "View on GitHub" on the last is a ≥ 32 px hit area grown equally above and
  // below its glyphs (21 px on Windows), and stops short of the nav row under it.
  const meta390 = await page.evaluate(metaGeometry);
  expectWholeLines(meta390, 'at 390');
  const github390 = meta390.links.find((link) => link.label === 'View on GitHub')!;
  expect(github390.box.height, '"View on GitHub" hit area at 390').toBeGreaterThanOrEqual(32);
  expect(Math.abs(middle(github390.box) - middle(github390.text)), 'hit area centred on the glyphs').toBeLessThan(1);
  expect(github390.box.bottom, 'hit area clear of the nav row').toBeLessThan(meta390.navTop);
  expect(github390.tapsHit).toBe(true);

  // Back at desktop width the four columns are back, the number columns at their 3.6em (measured on
  // the header cell: WebKit gives a <col> no getBoundingClientRect box).
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(table.locator('thead th').nth(0)).toBeVisible();
  await expect(table.locator('thead th').nth(1)).toBeVisible();
  const colWidth = await page.evaluate(() => document.querySelector('table.diff thead th:nth-child(1)')!.getBoundingClientRect().width);
  expect(colWidth, 'first line-number column at 1280').toBeGreaterThan(40);
  // ... and the meta line is whole lines again (1 line / 27.45 px on Windows at 1280), the hit area
  // still ≥ 32 with nothing scrolling sideways.
  const meta1280 = await page.evaluate(metaGeometry);
  expect(meta1280.scrollWidth, 'page scrollWidth at 1280').toBe(1280);
  expectWholeLines(meta1280, 'at 1280');
  expect(meta1280.links.find((link) => link.label === 'View on GitHub')!.box.height).toBeGreaterThanOrEqual(32);
});

test('in the meta line, "View on GitHub" and the badge link are ≥ 32 px hit areas that leave the text, the line and the badge in place', async ({
  page,
}) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  // Tablet portrait, where the QA pass measured them (#1458): on Windows the meta line is 1 line /
  // 27.45 px (1.7 × 16.15) with "View on GitHub" a 112 × 21 px link, the badge 230 × 24.56 around a
  // 213 × 20 link; a wider font may wrap it, so the height is asserted as whole lines.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(to('/history/3/'));
  const tablet = await page.evaluate(metaGeometry);
  expect(tablet.scrollWidth).toBe(768);
  expectWholeLines(tablet, 'at 768 on /history/3/');
  expect(tablet.links.map((link) => link.label)).toEqual(['View on GitHub']);
  const github = tablet.links[0]!;
  expect(github.box.height, '"View on GitHub" hit area').toBeGreaterThanOrEqual(32);
  // The text stayed put: its glyphs sit a whole number of lines below the date's (0 on Windows), the
  // box is centred on them and no wider than them, and it ends above the nav row.
  expect(github.text.height, 'the glyphs, not the box, are text-height').toBeLessThan(32);
  const offset = (github.text.top - tablet.time.top) / tablet.lineHeight;
  expect(offset, 'glyphs on a line of the meta paragraph').toBeCloseTo(Math.round(offset), 1);
  expect(Math.round(offset)).toBeGreaterThanOrEqual(0);
  expect(Math.abs(middle(github.box) - middle(github.text)), 'hit area centred on the glyphs').toBeLessThan(1);
  expect(Math.abs(github.box.width - github.text.width), 'no horizontal padding').toBeLessThan(0.5);
  expect(github.box.bottom).toBeLessThan(tablet.navTop);
  expect(github.tapsHit).toBe(true);

  // The published revision: the badge's link too, with the pill itself (line-height tall, 0.6em of
  // padding each side of the text) exactly as it was and the hit area centred on it. The line is still
  // whole line boxes (1 / 27.45 px on Windows; CI's wider font wraps the badge onto a second).
  await page.goto(to(`/history/${count}/`));
  const badged = await page.evaluate(metaGeometry);
  expectWholeLines(badged, 'at 768 with the badge');
  expect(badged.badge).not.toBeNull();
  const badge = badged.badge!;
  expect(badge.height, '.badge height (24.56 on main)').toBeCloseTo(24.56, 1);
  expect(badged.links.map((link) => link.label)).toEqual(['View on GitHub', 'the version on the sample page']);
  const [gh, sample] = badged.links as [MetaLink, MetaLink];
  expect(sample.box.height, 'badge link hit area').toBeGreaterThanOrEqual(32);
  expect(gh.box.height).toBeGreaterThanOrEqual(32);
  expect(Math.abs(badge.width - (sample.text.width + 2 * 0.6 * 14.45)), '.badge width is its text + padding').toBeLessThan(0.5);
  expect(sample.text.top).toBeGreaterThan(badge.top);
  expect(sample.text.bottom).toBeLessThan(badge.bottom);
  expect(Math.abs(middle(sample.box) - middle(badge)), 'hit area centred on the pill').toBeLessThan(1);
  expect(sample.box.bottom).toBeLessThan(badged.navTop);
  expectCoexist(gh, sample, 'at 768');
  for (const link of badged.links) expect(link.tapsHit, `taps on "${link.label}"`).toBe(true);

  // Phone: on Windows the meta wraps to two lines and "View on GitHub" shares the second with the
  // badge (side by side); a wider font stacks them. Either way both hit areas stay ≥ 32 px and tappable.
  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(metaGeometry);
  expect(phone.scrollWidth).toBe(390);
  const [gh390, sample390] = phone.links as [MetaLink, MetaLink];
  for (const link of phone.links) {
    expect(link.box.height, `"${link.label}" hit area at 390`).toBeGreaterThanOrEqual(32);
    expect(link.tapsHit, `taps on "${link.label}" at 390`).toBe(true);
  }
  expectCoexist(gh390, sample390, 'at 390');
  expect(Math.max(gh390.box.bottom, sample390.box.bottom)).toBeLessThan(phone.navTop);
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
