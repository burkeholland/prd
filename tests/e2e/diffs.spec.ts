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
  ? (JSON.parse(readFileSync(HISTORY, 'utf8')) as {
      count: number;
      revisions: { n: number; version: string; short: string }[];
    })
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
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://burkeholland.github.io/prd/history/13/',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);

  // Previous / All revisions / Next are a list rendered twice — under the header and after the diff —
  // with the same hrefs in each; source and download actions stay together above the first nav.
  const navs = page.locator('nav.revision__nav');
  await expect(navs).toHaveCount(2);
  for (const nav of [navs.first(), navs.last()]) {
    await expect(nav.locator('a', { hasText: 'Previous' })).toHaveAttribute('href', to('/history/12/'));
    await expect(nav.locator('a', { hasText: 'Next' })).toHaveAttribute('href', to('/history/14/'));
    await expect(nav.locator('a', { hasText: 'All revisions' })).toHaveAttribute('href', to('/history/'));
    await expect(nav.locator('a')).toHaveText(['Previous', 'All revisions', 'Next']);
  }
  await expect(page.locator('.revision__actions > a', { hasText: 'View on GitHub' })).toHaveAttribute('href', /^https:\/\/gist\.github\.com\//);
  await expect(page.locator('.revision__actions > a', { hasText: 'Download Markdown' })).toHaveAttribute(
    'href',
    to(`/history/revision-13-${history!.revisions.find((revision) => revision.n === 13)!.short}.md`),
  );
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

test('every revision page responds 200 and progressively ships its revision-link action', async ({ page, request }) => {
  for (let n = 1; n <= count; n++) {
    const response = await request.get(to(`/history/${n}/`));
    expect(response.status(), `/history/${n}/ status`).toBe(200);
  }
  for (const n of [1, 3, 13].filter((n) => n <= count)) {
    await page.goto(to(`/history/${n}/`));
    await expect(
      page.getByRole('button', { name: `Copy revision ${n} link`, exact: true }),
      `/history/${n}/ revision-link action`,
    ).toHaveCount(1);
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

function actionGeometry() {
  const plain = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  const box = (el: Element) => plain(el.getBoundingClientRect());
  const actions = document.querySelector('.revision__actions')!;
  const links = Array.from(actions.querySelectorAll('a, button'), (action) => {
    const target = box(action);
    const probes: [number, number][] = [
      [target.left + target.width / 2, target.top + target.height / 2],
      [target.left + target.width / 2, target.top + 1],
      [target.left + target.width / 2, target.bottom - 1],
      [target.left + 1, target.top + target.height / 2],
      [target.right - 1, target.top + target.height / 2],
    ];
    return {
      label: action.textContent?.trim() ?? '',
      box: target,
      tapsHit: probes.every(([x, y]) => document.elementFromPoint(x, y)?.closest('a, button') === action),
    };
  });
  return {
    scrollWidth: document.documentElement.scrollWidth,
    actions: box(actions),
    links,
    navTop: document.querySelector('nav.revision__nav')!.getBoundingClientRect().top,
  };
}
type ActionRect = ReturnType<typeof actionGeometry>['actions'];
const intersects = (a: ActionRect, b: ActionRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

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

  const actions390 = await page.evaluate(actionGeometry);
  expect(actions390.links.map((link) => link.label)).toEqual([
    'View on GitHub',
    'Download Markdown',
    'Copy revision link',
  ]);
  for (const link of actions390.links) {
    expect(link.box.width, `"${link.label}" width at 390`).toBeGreaterThanOrEqual(32);
    expect(link.box.height, `"${link.label}" height at 390`).toBeGreaterThanOrEqual(32);
    expect(link.box.bottom, `"${link.label}" clear of the nav`).toBeLessThan(actions390.navTop);
    expect(link.tapsHit, `taps on "${link.label}" at 390`).toBe(true);
  }
  for (let first = 0; first < actions390.links.length; first += 1) {
    for (let second = first + 1; second < actions390.links.length; second += 1) {
      expect(
        intersects(actions390.links[first]!.box, actions390.links[second]!.box),
        'revision actions overlap at 390',
      ).toBe(false);
    }
  }

  // Back at desktop width the four columns are back, the number columns at their 3.6em (measured on
  // the header cell: WebKit gives a <col> no getBoundingClientRect box).
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(table.locator('thead th').nth(0)).toBeVisible();
  await expect(table.locator('thead th').nth(1)).toBeVisible();
  const colWidth = await page.evaluate(() => document.querySelector('table.diff thead th:nth-child(1)')!.getBoundingClientRect().width);
  expect(colWidth, 'first line-number column at 1280').toBeGreaterThan(40);
  const actions1280 = await page.evaluate(actionGeometry);
  expect(actions1280.scrollWidth, 'page scrollWidth at 1280').toBe(1280);
  for (const link of actions1280.links) expect(link.box.height).toBeGreaterThanOrEqual(32);
});

test('revision actions are non-overlapping ≥ 32 px targets at phone, tablet and desktop widths', async ({ page }) => {
  test.skip(count < 3, 'fewer than 3 revisions');
  for (const viewport of [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(to(`/history/${count}/`));
    const geometry = await page.evaluate(actionGeometry);
    expect(geometry.scrollWidth, `${viewport.width} page width`).toBe(viewport.width);
    expect(geometry.links.map((link) => link.label)).toEqual([
      'View on GitHub',
      'Download Markdown',
      'Copy revision link',
      'the version on the sample page',
    ]);
    for (const link of geometry.links) {
      expect(link.box.width, `${viewport.width} "${link.label}" width`).toBeGreaterThanOrEqual(32);
      expect(link.box.height, `${viewport.width} "${link.label}" height`).toBeGreaterThanOrEqual(32);
      expect(link.box.bottom, `${viewport.width} "${link.label}" clear of nav`).toBeLessThan(geometry.navTop);
      expect(link.tapsHit, `${viewport.width} taps on "${link.label}"`).toBe(true);
    }
    for (let first = 0; first < geometry.links.length; first += 1) {
      for (let second = first + 1; second < geometry.links.length; second += 1) {
        expect(
          intersects(geometry.links[first]!.box, geometry.links[second]!.box),
          `${viewport.width} "${geometry.links[first]!.label}" and "${geometry.links[second]!.label}" overlap`,
        ).toBe(false);
      }
    }
  }
});

test('the sitemap lists no revision page', async ({ request }) => {
  const response = await request.get(to('/sitemap-0.xml'));
  expect(response.status()).toBe(200);
  const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');
  expect(locs.length).toBeGreaterThan(0);
  expect(locs.filter((loc) => /\/history\/\d+\/?$/.test(loc)), 'revision pages in the sitemap').toEqual([]);
});

test('revision 3 leads with its hand-written note without adding history to the primary nav', async ({ page }) => {
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

  await expect(page.locator('nav.site-nav a')).toHaveText(['Create', 'Example', 'Downloads']);
  await expect(page.locator('nav.site-nav a[aria-current="page"]')).toHaveCount(0);
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

  // The View cell: one "Diff", one same-origin Markdown download and one gist link per row.
  const diffs = table.locator('tbody a[aria-label^="Diff of revision "]');
  const downloads = table.locator('tbody a[aria-label^="Download revision "]');
  await expect(diffs).toHaveCount(count);
  await expect(downloads).toHaveCount(count);
  await expect(diffs.nth(2)).toHaveText('Diff');
  await expect(diffs.nth(2)).toHaveAttribute('href', to('/history/3/'));
  await expect(diffs.nth(2)).toHaveAttribute('aria-label', 'Diff of revision 3');
  await expect(downloads.nth(2)).toHaveText('Markdown');
  await expect(downloads.nth(2)).toHaveAttribute('download', /revision-3-[0-9a-f]{7}\.md$/);
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
