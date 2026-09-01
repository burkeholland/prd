import { expect, test } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// Every kind of page the site has: home, the four documents, the history table and one diff page.
const START_PAGES = ['/', '/sample/', '/guide/', '/walkthrough/', '/template/', '/history/', '/history/3/'];

/** `/prd/x` and `/prd/x/` are the same page; files such as `/prd/raw/x.md` keep their exact path. */
const samePage = (pathname: string) => {
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last === '' || last.includes('.') ? pathname : `${pathname}/`;
};

/**
 * Crawls one page: every `a[href]` in `main`, `nav` and `footer` that stays on this origin must
 * answer 200, and every `#fragment` (same-page or on another page) must name an element `id`.
 * `scripts/check-content.mjs` already validates the links written in `content/*.md`; this covers
 * what it cannot see — the nav, the footer, the table of contents, the history table, the diff
 * pages — against the built site. Each distinct target is fetched once per test.
 */
for (const start of START_PAGES) {
  test(`every in-site link on ${start} answers 200 and every #fragment has a target`, async ({ page }) => {
    const response = await page.goto(to(start));
    expect(response?.status(), `${start} status`).toBe(200);
    const origin = new URL(page.url()).origin;

    const hrefs = await page
      .locator('main a[href], nav a[href], footer a[href]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(hrefs.length, `${start} has links`).toBeGreaterThan(0);

    // Same-page fragments (the skip link, the table of contents) resolve against the page as loaded.
    const ownFragments = hrefs.filter((href) => href.startsWith('#') && href !== '#').map((href) => href.slice(1));
    const missingOwn = await page.evaluate(
      (fragments) => fragments.filter((fragment) => document.getElementById(decodeURIComponent(fragment)) === null),
      ownFragments,
    );
    expect(missingOwn, `${start} same-page fragments without a target`).toEqual([]);

    // In-site links: same origin, http(s). `mailto:`, `href="#"` and other hosts are skipped.
    const inSite = hrefs
      .filter((href) => href !== '#' && !href.startsWith('#'))
      .map((href) => new URL(href, origin))
      .filter((url) => url.origin === origin && /^https?:$/.test(url.protocol));
    expect(inSite.length, `${start} in-site links`).toBeGreaterThan(0);
    for (const url of inSite) {
      expect(url.pathname.startsWith(`${BASE}/`), `${url.pathname} on ${start} is under the base`).toBe(true);
    }

    // Each distinct path is fetched once; a page whose fragments are referenced is loaded once.
    const statuses = new Map<string, number>();
    const fragmentsByPage = new Map<string, Set<string>>();
    for (const url of inSite) {
      const path = samePage(url.pathname);
      if (!statuses.has(path)) statuses.set(path, (await page.request.get(path)).status());
      if (url.hash.length > 1) {
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (!fragmentsByPage.has(path)) fragmentsByPage.set(path, new Set());
        fragmentsByPage.get(path)?.add(fragment);
      }
    }
    const notOk = [...statuses].filter(([, status]) => status !== 200).map(([path, status]) => `${path} → ${status}`);
    expect(notOk, `${start} in-site links that do not answer 200`).toEqual([]);

    const missing: string[] = [];
    let fragmentCount = 0;
    for (const [path, fragments] of fragmentsByPage) {
      fragmentCount += fragments.size;
      await page.goto(path);
      const absent = await page.evaluate(
        (list) => list.filter((fragment) => document.getElementById(fragment) === null),
        [...fragments],
      );
      missing.push(...absent.map((fragment) => `${path}#${fragment}`));
    }
    expect(missing, `${start} fragments without a matching id`).toEqual([]);

    test.info().annotations.push({
      type: 'in-site links',
      description:
        `${start}: ${inSite.length} in-site links → ${statuses.size} distinct paths, all 200; ` +
        `${fragmentCount} fragments on ${fragmentsByPage.size} pages, all resolve; ` +
        `${ownFragments.length} same-page fragments, all resolve; ` +
        `${hrefs.length - inSite.length - ownFragments.length} skipped (external, mailto:, "#")`,
    });
  });
}
