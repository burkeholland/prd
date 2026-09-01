import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// `title` is set only where the page's <title> does not start with the nav label (doc pages
// title themselves by their h1, see Doc.astro). One name per page: these labels are also the
// card titles on `/` and how prose names each page.
const NAV: { href: string; label: string; title?: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/sample/', label: 'The sample PRD' },
  { href: '/guide/', label: 'The guide', title: 'How to write a PRD an agent can build from' },
  { href: '/walkthrough/', label: 'The walkthrough', title: 'The sample PRD, section by section' },
  { href: '/history/', label: 'How it evolved', title: 'How this PRD evolved' },
  { href: '/template/', label: 'The template', title: 'PRD template' },
];

// Doc pages and the repo-root content file each one renders. Files that other tasks may not
// have merged yet make their assertions conditional (`test.skip(!present, …)`); a page whose
// file is absent renders the "Content is on its way." placeholder instead of failing the build.
const CONTENT = {
  gist: 'content/gist/build-the-urlist.md',
  guide: 'content/guide.md',
  walkthrough: 'content/walkthrough.md',
  template: 'content/template.md',
  gistMeta: 'content/gist/meta.json',
  rawGist: 'public/raw/build-the-urlist.md',
  cleanTemplate: 'public/prd-template.md',
  history: 'content/gist/history.json',
};
const present = (file: string) => existsSync(resolve(file));

const BRAND = 'PRD Field Guide';
const PLACEHOLDER = 'Content is on its way.';
const MOCKS = to('/mocks/');

/** Every `id` on the page, for resolving `#fragment` links. */
const idsOn = async (page: Page) =>
  new Set(await page.evaluate(() => Array.from(document.querySelectorAll('[id]'), (el) => el.id)));

/** Asserts the sidebar table of contents links only to headings that exist on the page. */
async function expectTocResolves(page: Page, path: string, minHeadings: number) {
  await page.goto(to(path));
  const h2s = await page.locator('.doc__body h2').count();
  expect(h2s, `${path} h2 count`).toBeGreaterThanOrEqual(minHeadings);

  const hrefs = await page.locator('aside.toc--sidebar .toc__list a').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href') ?? ''),
  );
  expect(hrefs.length, `${path} TOC links`).toBeGreaterThanOrEqual(minHeadings);

  const ids = await idsOn(page);
  const unresolved = hrefs.filter((href) => !href.startsWith('#') || !ids.has(href.slice(1)));
  expect(unresolved, `${path} TOC anchors without a matching id`).toEqual([]);
  return { headings: h2s, links: hrefs.length };
}

test('home has one h1, four cards named like the nav, and makes no cross-origin requests', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  await page.goto(to('/'));

  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Write a PRD an agent can build.');

  const cards = page.locator('a.card');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toHaveAttribute('href', to('/sample/'));
  await expect(cards.nth(1)).toHaveAttribute('href', to('/guide/'));
  await expect(cards.nth(2)).toHaveAttribute('href', to('/walkthrough/'));
  await expect(cards.nth(3)).toHaveAttribute('href', to('/history/'));
  // One name per page: each card carries the nav label of the page it leads to.
  const labelOf = (href: string) => NAV.find((item) => item.href === href)?.label ?? '';
  await expect(cards.locator('h2')).toHaveText(
    ['/sample/', '/guide/', '/walkthrough/', '/history/'].map(labelOf),
  );

  await expect(page.locator('nav.site-nav a')).toHaveCount(6);
  await expect(page.locator('nav.site-nav a')).toHaveText(NAV.map((item) => item.label));

  const own = new URL(page.url()).origin;
  expect([...origins]).toEqual([own]);
});

test('home states the thesis once: the lede defines PRD and names Burke; "Why specificity wins" has four points', async ({
  page,
}) => {
  await page.goto(to('/'));

  const lede = page.locator('p.lede');
  await expect(lede).toContainText('product requirements document (PRD)');
  await expect(lede).toContainText('Burke Holland');
  await expect(lede.locator('a[href="https://github.com/burkeholland"]')).toHaveText('Burke Holland');
  await expect(lede).toContainText('a link-sharing app');
  await expect(lede).toContainText('traces how it evolved');
  // The lede says "agent" for the actor, never "model", and the page does not repeat the thesis.
  const text = (await page.locator('main').innerText()).toLowerCase();
  expect(text.includes('model'), 'the word "model" on /').toBe(false);
  expect(text.split('build the whole app').length - 1, 'thesis stated once').toBe(1);

  const heading = page.locator('h2', { hasText: 'Why specificity wins' });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText('Why specificity wins');
  await expect(heading.locator('xpath=following-sibling::ul[1]/li')).toHaveCount(4);
});

test('home puts a reading order above the cards and a template line below them', async ({ page }) => {
  await page.goto(to('/'));

  const strip = page.locator('section.strip');
  await expect(strip).toHaveCount(1);
  await expect(strip.locator('.strip__label')).toHaveText('New here?');
  await expect(strip).toContainText(
    'Read the sample PRD (about ten minutes), then the seven habits in the guide, then copy the template.',
  );
  await expect(strip.locator('a')).toHaveCount(3);
  await expect(strip.locator('a', { hasText: 'the sample PRD' })).toHaveAttribute('href', to('/sample/'));
  await expect(strip.locator('a', { hasText: 'the guide' })).toHaveAttribute('href', to('/guide/'));
  await expect(strip.locator('a', { hasText: 'the template' })).toHaveAttribute('href', to('/template/'));

  // DOM order: hero → reading order → cards → "Ready to write?" → "Why specificity wins".
  const order = await page.evaluate(() =>
    Array.from(document.querySelectorAll('main > *'), (el) => el.className || el.tagName.toLowerCase()),
  );
  expect(order.indexOf('strip'), 'strip precedes the cards').toBeLessThan(order.indexOf('cards'));
  expect(order.indexOf('cards'), 'cards precede the template line').toBeLessThan(order.indexOf('ready'));

  const ready = page.locator('p.ready');
  await expect(ready).toHaveText('Ready to write? The template →');
  await expect(ready.locator('a')).toHaveAttribute('href', to('/template/'));
  // No heading of its own in the strip or the line, so the outline stays h1 → h2s (axe heading-order).
  await expect(strip.locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0);
});

test('home on a phone (390×844): one-row header under 110px, no sideways scroll, reading order above the fold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(to('/'));

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const items = Array.from(document.querySelectorAll('nav.site-nav li'), (li) => li.getBoundingClientRect());
    const links = Array.from(document.querySelectorAll('nav.site-nav a'), (a) => a.getBoundingClientRect().height);
    const lede = document.querySelector<HTMLElement>('p.lede')!;
    return {
      header: rect('.site-header').height,
      navRows: new Set(items.map((item) => Math.round(item.top))).size,
      linkMinHeight: Math.min(...links),
      scrollWidth: document.documentElement.scrollWidth,
      stripBottom: rect('section.strip').bottom,
      ledeWords: lede.innerText.trim().split(/\s+/).length,
    };
  });
  expect(geometry.header, '.site-header height').toBeLessThanOrEqual(110);
  expect(geometry.navRows, 'nav rows').toBe(1);
  expect(geometry.linkMinHeight, 'nav link tap target').toBeGreaterThanOrEqual(32);
  expect(geometry.scrollWidth, 'no horizontal scroll').toBe(390);
  expect(geometry.stripBottom, 'the "New here?" strip ends on the first screen').toBeLessThanOrEqual(844);
  expect(geometry.ledeWords, 'lede word count').toBeLessThanOrEqual(70);
  // The row scrolls; nothing is hidden, so every route stays reachable from the header.
  await expect(page.locator('nav.site-nav a')).toHaveCount(6);
});

test('phone nav (390×844, and 640–767 e.g. 700×400 / 760×400): one swipeable row that starts with the current page\'s item in view, Home at 0; 768 keeps the wrapped list', async ({
  page,
}) => {
  // Chromium-only progressive enhancement (`scroll-initial-target: nearest`, Chromium 133+); Safari and
  // Firefox ignore it and start the row at Home. Playwright here runs Chromium only (playwright.config.ts).
  await page.setViewportSize({ width: 390, height: 844 });
  type Edges = { left: number; right: number };
  type Geometry = {
    scrollLeft: number;
    list: Edges;
    current: Edges;
    /** The item the list's left edge cuts through, if any (its start is off the scrollport). */
    cut: Edges | null;
    homeLeft: number;
    brandLeft: number;
    /** The left-edge fade, `.site-nav::before`; `left` is where it starts on the page. */
    fade: { left: number; width: number; opacity: number };
    scrollWidth: number;
    /** `.site-header` height and the number of distinct nav-item rows. */
    header: number;
    navRows: number;
    /** Distinct `li` tops, ascending (two entries when the wrapped list takes two rows). */
    rowTops: number[];
    /** One `li`'s height and the list's row gap: their sum is the pitch of a second row. */
    liHeight: number;
    rowGap: number;
    /** The list's scrollable vs visible width: equal when the six labels fit one row. */
    ul: { scrollWidth: number; clientWidth: number };
    /** `content` of the two fades, `none` where the phone block does not apply. */
    before: string;
    after: string;
    brandHeight: number;
  };
  const geometry = () =>
    page.evaluate(
      () =>
        // Two frames in: the left fade is a scroll-driven animation that samples its timeline in the
        // frame's animation step, so a style read straight after `load` still sees the pre-frame opacity.
        new Promise<Geometry>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const nav = document.querySelector<HTMLElement>('nav.site-nav')!;
              const ul = nav.querySelector('ul')!;
              const list = ul.getBoundingClientRect();
              const current = nav.querySelector('a[aria-current="page"]')!.getBoundingClientRect();
              const items = Array.from(ul.querySelectorAll('li'), (li) => li.getBoundingClientRect());
              const cut = items.find((li) => li.left < list.left && li.right > list.left);
              const rowTops = [...new Set(items.map((li) => Math.round(li.top)))]
                .sort((a, b) => a - b)
                .map((rounded) => items.find((li) => Math.round(li.top) === rounded)!.top);
              const fade = getComputedStyle(nav, '::before');
              const brand = document.querySelector('.brand')!.getBoundingClientRect();
              resolve({
                scrollLeft: ul.scrollLeft,
                list: { left: list.left, right: list.right },
                current: { left: current.left, right: current.right },
                cut: cut ? { left: cut.left, right: cut.right } : null,
                homeLeft: nav.querySelector('a')!.getBoundingClientRect().left,
                brandLeft: brand.left,
                fade: {
                  left: nav.getBoundingClientRect().left + parseFloat(fade.left),
                  width: parseFloat(fade.width),
                  opacity: parseFloat(fade.opacity),
                },
                scrollWidth: document.documentElement.scrollWidth,
                header: document.querySelector('.site-header')!.getBoundingClientRect().height,
                navRows: rowTops.length,
                rowTops,
                liHeight: items[0].height,
                rowGap: parseFloat(getComputedStyle(ul).rowGap),
                ul: { scrollWidth: ul.scrollWidth, clientWidth: ul.clientWidth },
                before: fade.content,
                after: getComputedStyle(nav, '::after').content,
                brandHeight: brand.height,
              });
            }),
          ),
        ),
    );

  // The template is the last item and the walkthrough the fourth: both start off the right edge otherwise.
  for (const path of ['/template/', '/walkthrough/']) {
    await page.goto(to(path));
    const g = await geometry();
    expect(g.current.left, `${path} current item left edge`).toBeGreaterThanOrEqual(g.list.left);
    // 40px = the 2.5rem fades: the lit item must sit clear of both, not under either.
    expect(g.current.left, `${path} current item clear of the left fade`).toBeGreaterThanOrEqual(g.list.left + 40);
    expect(g.current.right, `${path} current item right edge`).toBeLessThanOrEqual(g.list.right - 40);
    expect(g.scrollWidth, `${path} no horizontal scroll`).toBe(390);
    // A pre-scrolled row fades in at the left instead of cutting the first visible item mid-word: the
    // fade starts where the list does, is at least 2.5rem wide, and is painted (opacity 1) once scrolled.
    expect(g.fade.left, `${path} left fade starts at the list's left edge`).toBeCloseTo(g.list.left, 1);
    expect(g.fade.width, `${path} left fade width`).toBeGreaterThanOrEqual(40);
    expect(g.fade.opacity, `${path} left fade painted when scrolled`).toBe(1);
    if (path === '/template/') {
      // The row is scrolled to its end here, so an item really is cut by the list's left edge.
      expect(g.cut, `${path} an item spans the list's left edge`).not.toBeNull();
      expect(g.cut!.left, `${path} cut item starts off the scrollport`).toBeLessThan(g.list.left);
    }
  }

  // Home is the first item: nothing moves. Its left edge is the brand's (17px at 390 wide, the value
  // before the left fade existed), and the fade is not painted at scrollLeft 0, so Home is never under it.
  await page.goto(to('/'));
  const home = await geometry();
  expect(home.scrollLeft, '/ row scrollLeft').toBe(0);
  expect(home.scrollWidth, '/ no horizontal scroll').toBe(390);
  expect(home.homeLeft, '/ Home link left edge').toBeCloseTo(17, 1);
  expect(home.homeLeft, '/ Home lines up with the brand').toBeCloseTo(home.brandLeft, 1);
  expect(home.fade.opacity, '/ left fade hidden at scrollLeft 0').toBe(0);
  // The brand link is a thumb-sized target (task #1475) without making the header taller: 97.83 at 390
  // is the height from before it had any block padding.
  expect(home.brandHeight, '/ 390: a.brand height').toBeGreaterThanOrEqual(32);
  expect(home.header, '/ 390: .site-header height (unchanged)').toBeCloseTo(97.83, 0);

  // 640–767 (landscape phones, task #1475): the same one swipeable row. Before, the wrapped list took two
  // rows here and the header was 144.9 px — 40 % of a 360 px-tall screen. The lit item still lands clear
  // of the left fade and the document never scrolls sideways (the list scrolls inside itself).
  await page.setViewportSize({ width: 700, height: 400 });
  for (const path of ['/template/', '/walkthrough/']) {
    await page.goto(to(path));
    const g = await geometry();
    expect(g.header, `${path} 700: .site-header height (one nav row, was 144.9)`).toBeLessThan(110);
    expect(g.header, `${path} 700: .site-header height (the 390 px value)`).toBeCloseTo(97.83, 0);
    expect(g.navRows, `${path} 700: nav rows`).toBe(1);
    expect(g.ul.scrollWidth, `${path} 700: the six labels do not fit, the row scrolls`).toBeGreaterThan(g.ul.clientWidth);
    expect(g.current.left, `${path} 700: current item clear of the left fade`).toBeGreaterThanOrEqual(g.list.left + 40);
    expect(g.before, `${path} 700: left fade present`).not.toBe('none');
    expect(g.after, `${path} 700: right fade present`).not.toBe('none');
    expect(g.scrollWidth, `${path} 700: no horizontal scroll`).toBe(700);
    expect(g.brandHeight, `${path} 700: a.brand height`).toBeGreaterThanOrEqual(32);
  }
  await page.goto(to('/'));
  const home700 = await geometry();
  expect(home700.scrollLeft, '/ 700: row scrollLeft').toBe(0);
  expect(home700.homeLeft, '/ 700: Home lines up with the brand').toBeCloseTo(home700.brandLeft, 1);
  expect(home700.fade.opacity, '/ 700: left fade hidden at scrollLeft 0').toBe(0);

  // 760, the last width before the list wraps: the row needs its start gutter, 1rem gaps and 2.5rem end
  // padding, so on Windows fonts the six labels are still 7 px short of fitting (737 vs 730) and the row
  // scrolls; wider Linux fonts overflow more. Either way it is one row under 110 px with Home at the brand.
  await page.setViewportSize({ width: 760, height: 400 });
  await page.goto(to('/'));
  const home760 = await geometry();
  expect(home760.header, '/ 760: .site-header height').toBeLessThan(110);
  expect(home760.navRows, '/ 760: nav rows').toBe(1);
  expect(home760.after, '/ 760: right fade present').not.toBe('none');
  expect(
    home760.ul.scrollWidth,
    '/ 760: the row still scrolls — the six labels are 7 px short of fitting on Windows fonts (737 vs 730)',
  ).toBeGreaterThan(home760.ul.clientWidth);
  expect(home760.scrollLeft, '/ 760: row scrollLeft').toBe(0);
  expect(home760.homeLeft, '/ 760: Home lines up with the brand').toBeCloseTo(home760.brandLeft, 1);
  expect(home760.fade.opacity, '/ 760: left fade hidden at scrollLeft 0').toBe(0);
  expect(home760.scrollWidth, '/ 760: no horizontal scroll').toBe(760);

  // 768 (portrait tablet): untouched — brand row plus the wrapped list, no fades, nothing scrolls. How many
  // rows the list takes depends on the font: with Segoe UI (Windows) the six labels fit one row and the
  // header is 106.33; with CI's DejaVu Sans, ≈ 8 % wider, they wrap to two rows and the header grows by
  // exactly one row pitch (`li` height + row gap, 38.53). Assert that relation, not the Windows outcome —
  // either way the brand's padding must not have added to the height.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(to('/guide/'));
  const tablet = await geometry();
  expect([1, 2], "/guide/ 768: nav rows (1 on Windows fonts, 2 on CI's wider DejaVu)").toContain(tablet.navRows);
  const rowPitch =
    tablet.navRows === 2 ? tablet.rowTops[1] - tablet.rowTops[0] : tablet.liHeight + tablet.rowGap;
  expect(
    tablet.header,
    '/guide/ 768: header = brand row + nav rows (106.33 with one row, one row pitch more with two)',
  ).toBeCloseTo(106.33 + (tablet.navRows - 1) * rowPitch, 0);
  expect(tablet.before, '/guide/ 768: no left fade').toBe('none');
  expect(tablet.after, '/guide/ 768: no right fade').toBe('none');
  expect(tablet.ul.scrollWidth, '/guide/ 768: the wrapped list does not overflow').toBe(tablet.ul.clientWidth);
  expect(tablet.brandHeight, '/guide/ 768: a.brand height').toBeGreaterThanOrEqual(32);

  // Desktop: brand and nav share one row; the brand's padding does not change that height either.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(to('/guide/'));
  const desktop = await geometry();
  expect(desktop.header, '/guide/ 1280: .site-header height (unchanged)').toBeCloseTo(69.28, 0);
  expect(desktop.after, '/guide/ 1280: no right fade').toBe('none');
  expect(desktop.brandHeight, '/guide/ 1280: a.brand height').toBeGreaterThanOrEqual(32);
});

test('every nav route responds 200 with a title that starts with its label', async ({ page }) => {
  for (const item of NAV) {
    const response = await page.goto(to(item.href));
    expect(response?.status(), `${item.href} status`).toBe(200);

    const title = await page.title();
    const prefix = item.title ?? item.label;
    const allowed = item.href === '/' ? [prefix, BRAND] : [prefix];
    expect(
      allowed.some((prefix) => title.startsWith(prefix)),
      `${item.href} title "${title}" should start with ${allowed.join(' or ')}`,
    ).toBe(true);
  }
});

test('no page whose content exists says it is on its way', async ({ page }) => {
  const routes = ['/', '/sample/', '/guide/', '/history/'];
  if (present(CONTENT.walkthrough)) routes.push('/walkthrough/');
  if (present(CONTENT.template)) routes.push('/template/');

  for (const path of routes) {
    await page.goto(to(path));
    const html = await page.content();
    expect(html.split(PLACEHOLDER).length - 1, `${path} placeholder occurrences`).toBe(0);
    await expect(page.locator('p.placeholder'), `${path} placeholder element`).toHaveCount(0);
    await expect(page.locator('h1'), `${path} h1 count`).toHaveCount(1);
  }
});

test('the footer links to the gist and to the site source', async ({ page }) => {
  await page.goto(to('/'));
  const source = page.locator('footer a', { hasText: 'Source' });
  await expect(source).toHaveAttribute('href', 'https://github.com/burkeholland/prd');
  await expect(page.locator('footer a', { hasText: 'Report a problem' })).toHaveAttribute(
    'href',
    'https://github.com/burkeholland/prd/issues/new',
  );
});

// The deploy job polls this stamp on the live site until `sha` is the commit it just deployed
// (deploy.yml). Here the build is local, so `sha` is "local"; in Actions it is the 40-hex sha.
test('/build.json is JSON that stamps the build with a sha and a build time', async ({ page }) => {
  const response = await page.request.get(to('/build.json'));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('json');

  const stamp = JSON.parse(await response.text()) as { sha: unknown; builtAt: unknown };
  expect(typeof stamp.sha, 'sha is a string').toBe('string');
  expect(stamp.sha as string).toMatch(/^(local|[0-9a-f]{40})$/);
  expect(typeof stamp.builtAt, 'builtAt is a string').toBe('string');
  expect(Number.isNaN(new Date(stamp.builtAt as string).getTime()), 'builtAt parses as a date').toBe(false);
});

test('the sample PRD renders the gist with one h1 and seven local, captioned, lazy screenshots', async ({
  page,
}) => {
  await page.goto(to('/sample/'));

  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Build The Urlist');

  await expect(page.locator('img[src*="user-attachments"]')).toHaveCount(0);
  const images = page.locator(`img[src^="${MOCKS}"]`);
  await expect(images).toHaveCount(7);

  const details = await images.evaluateAll((nodes) =>
    nodes.map((node) => {
      const figure = node.closest('figure');
      let heading = figure?.previousElementSibling ?? null;
      while (heading && heading.tagName !== 'H4') heading = heading.previousElementSibling;
      const picture = node.closest('picture');
      const sources = picture ? Array.from(picture.querySelectorAll('source[type="image/webp"]')) : [];
      return {
        src: node.getAttribute('src') ?? '',
        loading: node.getAttribute('loading'),
        fetchpriority: node.getAttribute('fetchpriority'),
        decoding: node.getAttribute('decoding'),
        caption: figure?.querySelector('figcaption')?.textContent?.trim() ?? null,
        heading: heading?.textContent?.trim() ?? null,
        picture: picture !== null,
        sources: sources.length,
        srcset: sources[0]?.getAttribute('srcset') ?? '',
        sizes: sources[0]?.getAttribute('sizes') ?? '',
      };
    }),
  );

  // Bytes actually served: the seven PNG fallbacks against each set of derived WebP copies.
  const bytes = { png: 0, 760: 0, 1320: 0 };
  const sizeOf = async (url: string, type: string) => {
    const response = await page.request.get(url);
    expect(response.status(), `${url} status`).toBe(200);
    expect(response.headers()['content-type'], `${url} content-type`).toContain(type);
    const length = Number(response.headers()['content-length']);
    return Number.isFinite(length) && length > 0 ? length : (await response.body()).length;
  };

  for (const [index, img] of details.entries()) {
    // The first screenshot is the desktop LCP element: eager and high priority; the rest lazy.
    expect(img.loading, `${img.src} loading`).toBe(index === 0 ? 'eager' : 'lazy');
    expect(img.fetchpriority, `${img.src} fetchpriority`).toBe(index === 0 ? 'high' : null);
    expect(img.decoding, `${img.src} decoding`).toBe('async');
    expect(img.caption, `${img.src} caption`).toBeTruthy();
    expect(img.caption, `${img.src} caption matches the preceding #### heading`).toBe(img.heading);

    // <picture> with one WebP <source>: "<stem>-760.webp 760w, <stem>-1320.webp 1320w" under the base.
    expect(img.picture, `${img.src} is inside a <picture>`).toBe(true);
    expect(img.sources, `${img.src} WebP sources`).toBe(1);
    expect(img.sizes, `${img.src} sizes`).not.toBe('');
    const stem = img.src.slice(MOCKS.length).replace(/\.png$/, '');
    expect(stem, `${img.src} is a PNG under ${MOCKS}`).not.toBe(img.src);
    const candidates = img.srcset.split(',').map((candidate) => candidate.trim());
    expect(candidates, `${img.src} srcset candidates`).toEqual([
      `${MOCKS}derived/${stem}-760.webp 760w`,
      `${MOCKS}derived/${stem}-1320.webp 1320w`,
    ]);

    bytes.png += await sizeOf(img.src, 'image/png');
    bytes[760] += await sizeOf(`${MOCKS}derived/${stem}-760.webp`, 'image/webp');
    bytes[1320] += await sizeOf(`${MOCKS}derived/${stem}-1320.webp`, 'image/webp');
  }

  // At the default viewport (1280 wide) the browser takes the WebP candidate for its density, not the
  // PNG: 760w at DPR 1, 1320w at DPR 2. Every project pins DPR 1 (Desktop Safari's descriptor defaults
  // to 2, playwright.config.ts overrides it), so the pick is the same in all engines — assert both.
  await page.waitForLoadState('load');
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  expect(dpr, 'devicePixelRatio (the config pins 1 in every project)').toBe(1);
  const expectedWidth = dpr >= 2 ? 1320 : 760;
  const currentSrc = await images.first().evaluate((node) => (node as HTMLImageElement).currentSrc);
  expect(currentSrc, `first screenshot currentSrc at DPR ${dpr}`).toMatch(new RegExp(`-${expectedWidth}\\.webp$`));

  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  test.info().annotations.push({
    type: 'screenshot bytes',
    description: `7 PNG ${kb(bytes.png)} · 7 × 760w WebP ${kb(bytes[760])} · 7 × 1320w WebP ${kb(bytes[1320])}`,
  });
  expect(bytes[760], `760w set (${kb(bytes[760])}) lighter than the PNGs (${kb(bytes.png)})`).toBeLessThan(bytes.png);
  expect(bytes[1320], `1320w set (${kb(bytes[1320])}) lighter than the PNGs (${kb(bytes.png)})`).toBeLessThan(bytes.png);
});

test('the sample PRD offers the gist as a download that matches the file on disk', async ({ page }) => {
  await page.goto(to('/sample/'));

  const href = to('/raw/build-the-urlist.md');
  const link = page.locator(`a[download][href="${href}"]`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('Download .md');

  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  const body = await response.body();
  expect(body.length, 'download size equals the file on disk').toBe(statSync(resolve(CONTENT.rawGist)).size);
  expect(body.length).toBeGreaterThan(0);
});

test('the sample source card reads the gist metadata', async ({ page }) => {
  const meta = JSON.parse(readFileSync(resolve(CONTENT.gistMeta), 'utf8')) as {
    html_url: string;
    revision: string;
    fetched_at: string;
  };
  await page.goto(to('/sample/'));

  const card = page.locator('.source-card');
  await expect(card.locator('h1')).toHaveCount(0);
  // The intro says whose document it is, that it is unaltered, and what the screenshots show.
  const intro = card.locator('.source-card__title + p');
  await expect(intro).toContainText('Burke Holland’s real PRD for The Urlist, word for word from his GitHub gist');
  await expect(intro).toContainText('the target, not what the agent built');
  await expect(card).not.toContainText('verbatim');
  await expect(card.locator('a', { hasText: 'View on GitHub' })).toHaveAttribute('href', meta.html_url);
  await expect(card.locator('.source-card__links a', { hasText: 'How it evolved' })).toHaveAttribute(
    'href',
    to('/history/'),
  );
  await expect(card.locator('.source-card__meta')).toContainText('mirrored');
  await expect(card.locator('.source-card__meta')).not.toContainText('fetched');
  await expect(card.locator('.source-card__meta time')).toHaveAttribute('datetime', meta.fetched_at);
  await expect(card.locator('.source-card__meta time')).toHaveText(meta.fetched_at.slice(0, 10));

  const revision = card.locator('.source-card__meta a');
  await expect(revision).toHaveText(meta.revision.slice(0, 7));
  await expect(revision).toHaveAttribute('href', `${meta.html_url}/${meta.revision}`);

  // "Gist revision 16 of 16 (8ef29d7)": the snapshot's place in the gist history, from the data.
  if (present(CONTENT.history)) {
    const history = JSON.parse(readFileSync(resolve(CONTENT.history), 'utf8')) as {
      count: number;
      revisions: { n: number; version: string }[];
    };
    const current = history.revisions.find((rev) => rev.version === meta.revision);
    if (current) {
      await expect(card.locator('.source-card__meta')).toContainText(
        `Gist revision ${current.n} of ${history.count} (${meta.revision.slice(0, 7)})`,
      );
    }
  }
});

test('the guide links to the history page', async ({ page }) => {
  await page.goto(to('/guide/'));
  const links = page.locator(`main a[href="${to('/history/')}"]`);
  expect(await links.count(), 'guide → history links').toBeGreaterThanOrEqual(1);
  await expect(links.filter({ hasText: 'See how it evolved' })).toHaveCount(1);
});

test('the template page has a download button for the clean template', async ({ page }) => {
  test.skip(!present(CONTENT.template), 'content not merged yet');
  await page.goto(to('/template/'));

  const href = to('/prd-template.md');
  const button = page.locator(`.doc__header a[download][href="${href}"]`);
  await expect(button).toHaveCount(1);
  await expect(button).toHaveText('Download the clean template');

  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/^# Build \{Product Name\}/);
});

test('the guide has at least six sections and a table of contents that resolves', async ({ page }) => {
  await expectTocResolves(page, '/guide/', 6);
});

test('the sample PRD has a table of contents that resolves', async ({ page }) => {
  await expectTocResolves(page, '/sample/', 10);
});

test('the walkthrough has at least eighteen sections and a table of contents that resolves', async ({ page }) => {
  test.skip(!present(CONTENT.walkthrough), 'content not merged yet');
  await expectTocResolves(page, '/walkthrough/', 18);
});

test('every walkthrough link into the sample PRD lands on an existing heading', async ({ page }) => {
  test.skip(!present(CONTENT.walkthrough), 'content not merged yet');
  await page.goto(to('/walkthrough/'));
  const prefix = `${to('/sample/')}#`;
  const fragments = await page.locator(`.doc__body a[href^="${prefix}"]`).evaluateAll((nodes, start) =>
    nodes.map((node) => (node.getAttribute('href') ?? '').slice(start.length)),
    prefix,
  );
  expect(fragments.length, 'walkthrough links into /sample').toBeGreaterThan(0);

  await page.goto(to('/sample/'));
  const ids = await idsOn(page);
  const unresolved = [...new Set(fragments)].filter((fragment) => !ids.has(fragment));
  expect(unresolved, 'walkthrough → sample anchors without a heading').toEqual([]);
});

test('no horizontal scroll at 320px on /, /sample/ and /history/', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/sample/', '/history/']) {
    await page.goto(to(path));
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(320);
  }
});

test('pressing Tab once on / focuses the skip link', async ({ page, browserName }) => {
  test.skip(browserName === 'webkit', "WebKit skips links in sequential focus navigation (Safari's Tab-to-links is off by default)");
  await page.goto(to('/'));
  await page.keyboard.press('Tab');
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute('href', '#main');
});

test('every route emits only base-prefixed URLs and marks exactly one nav item current', async ({ page }) => {
  for (const item of NAV) {
    await page.goto(to(item.href));

    // Root-relative URLs that skip the base would 404 on GitHub Pages. Protocol-relative
    // `//host/...` values are a different thing and are ignored.
    const urls = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('a[href^="/"], img[src^="/"], link[href^="/"], script[src^="/"]'),
        (el) => el.getAttribute('href') ?? el.getAttribute('src') ?? '',
      ).filter((value) => !value.startsWith('//')),
    );
    expect(urls.length, `${item.href} has internal URLs to check`).toBeGreaterThan(0);
    const unbased = urls.filter((value) => !value.startsWith(`${BASE}/`));
    expect(unbased, `${item.href} un-based URLs`).toEqual([]);

    await expect(page.locator('nav.site-nav a[aria-current="page"]'), `${item.href} current nav item`).toHaveCount(1);
  }
});

test('the sample PRD shows its seven screenshots from under the base', async ({ page }) => {
  await page.goto(to('/sample/'));
  await page.waitForLoadState('load');

  const images = page.locator('.doc__body img');
  await expect(images).toHaveCount(7);

  // Lazy images below the fold only load once scrolled to; bring each into view first.
  const loaded = await images.evaluateAll(async (nodes) => {
    const imgs = nodes as HTMLImageElement[];
    for (const img of imgs) {
      img.scrollIntoView();
      if (!img.complete) {
        await new Promise((done) => {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      }
    }
    return imgs.map((img) => ({ src: img.getAttribute('src') ?? '', naturalWidth: img.naturalWidth }));
  });
  for (const img of loaded) {
    expect(img.src, 'screenshot src').toMatch(new RegExp(`^${BASE}/mocks/`));
    expect(img.naturalWidth, `${img.src} loaded`).toBeGreaterThan(0);
  }
});
test('the history page lists every gist revision, badges the published one, and ships a static chart with no script', async ({
  page,
}) => {
  test.skip(!present(CONTENT.history), 'gist history not merged yet');
  const history = JSON.parse(readFileSync(resolve(CONTENT.history), 'utf8')) as {
    count: number;
    revisions: { n: number; additions: number; deletions: number; bytes: number }[];
  };
  // Derived from the data, never hard-coded: revisions GitHub reports no counts for show `—` in
  // `+` and `−`; the first revision always shows counts. Today that is 2–6; a later data source may make it 0.
  const noCounts = history.revisions.filter((rev) => rev.additions + rev.deletions === 0 && rev.n !== 1).length;

  await page.goto(to('/history/'));
  await expect(page.locator('h1')).toHaveText('How this PRD evolved');

  const table = page.locator('table.history');
  await expect(table.locator('tbody tr')).toHaveCount(history.count);
  await expect(table.locator('mark')).toHaveCount(1);
  await expect(table.locator('mark a')).toHaveAttribute('href', to('/sample/'));
  await expect(table.locator('tbody a[href^="https://gist.github.com/"]')).toHaveCount(history.count);

  const dashes = await table.locator('tbody tr').evaluateAll((rows) =>
    rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td'), (cell) => cell.textContent?.trim() ?? '');
      return { plus: cells[1] === '—', minus: cells[2] === '—' };
    }),
  );
  expect(dashes.filter((row) => row.plus).length, '— in the + column').toBe(noCounts);
  expect(dashes.filter((row) => row.minus).length, '— in the − column').toBe(noCounts);
  expect(dashes.every((row) => row.plus === row.minus), '+ and − dash together').toBe(true);
  expect(dashes[0]?.plus, 'the first revision shows counts').toBe(false);
  await expect(page.locator('.history-note__counts'), 'footnote only when a row lacks counts').toHaveCount(noCounts > 0 ? 1 : 0);

  await expect(page.locator('svg.size-chart text.size-chart__label')).toHaveCount(history.count);
  await expect(page.locator('svg.size-chart rect')).toHaveCount(history.count);
  // The largest and the smallest bar carry their size as visible text (not only a <title>).
  const bytes = history.revisions.map((rev) => rev.bytes);
  const kb = (value: number) => `${(value / 1000).toFixed(1)} KB`;
  const values = page.locator('svg.size-chart text.size-chart__value');
  await expect(values).toHaveCount(2);
  await expect(values).toHaveText([kb(Math.max(...bytes)), kb(Math.min(...bytes))]);
  await expect(page.locator('script')).toHaveCount(0);
});

test('the history page tells the story in numbers from the data and labels whose counts are whose', async ({ page }) => {
  test.skip(!present(CONTENT.history), 'gist history not merged yet');
  const history = JSON.parse(readFileSync(resolve(CONTENT.history), 'utf8')) as {
    count: number;
    revisions: { n: number; version: string; bytes: number }[];
  };
  const meta = JSON.parse(readFileSync(resolve(CONTENT.gistMeta), 'utf8')) as { revision: string };
  const wholeKb = (value: number) => (value / 1000).toFixed(0);
  const first = history.revisions.find((rev) => rev.n === 1)!;
  const third = history.revisions.find((rev) => rev.n === 3)!;
  const shown = history.revisions.find((rev) => rev.version === meta.revision) ?? history.revisions.at(-1)!;

  await page.goto(to('/history/'));

  // The lede names the document and links it to the sample page, not to GitHub.
  const lede = page.locator('.history-page__header p.lede');
  await expect(lede.locator('a', { hasText: 'Build The Urlist' })).toHaveAttribute('href', to('/sample/'));
  await expect(lede).toContainText(`went through ${history.count} revisions`);

  // Three sentences: first-draft size, the revision-3 cut, the size on the sample page today — all from history.json.
  const story = page.locator('.history-page__header .history-page__story');
  await expect(story).toContainText(`The first draft was ${wholeKb(first.bytes)} KB and 32 sections.`);
  await expect(story).toContainText(`Revision 3 cut it to ${wholeKb(third.bytes)} KB and 13 sections.`);
  await expect(story).toContainText(`grew again to the ${wholeKb(shown.bytes)} KB on the sample page.`);
  await expect(story.locator('a', { hasText: 'the sample page' })).toHaveAttribute('href', to('/sample/'));

  // The + and − columns are GitHub's counts; the caption says so too, and the outro names the guide by its nav name.
  const headers = page.locator('table.history thead th');
  await expect(headers).toHaveText(['#', 'Date', '+ (GitHub)', '− (GitHub)', 'KB', 'Sections', 'What changed', 'View']);
  await expect(page.locator('table.history caption')).toContainText("GitHub's per-revision line counts");
  await expect(page.locator('.history-page__outro a', { hasText: 'the guide' })).toHaveAttribute('href', to('/guide/'));
  await expect(page.locator('.history-page__outro')).not.toContainText('How to write one');

  // The diff page marks its own count as this site's, so it is not mistaken for GitHub's.
  await page.goto(to('/history/3/'));
  await expect(page.locator('#diff-summary')).toContainText(/lines of text vs revision 2 \(this site's diff\)/);
});

test('at 390px the history table stacks each revision — number, date, note, counts — with no sideways scroll', async ({
  page,
}) => {
  test.skip(!present(CONTENT.history), 'gist history not merged yet');
  const history = JSON.parse(readFileSync(resolve(CONTENT.history), 'utf8')) as {
    count: number;
    revisions: { n: number; additions: number; deletions: number }[];
  };
  const noCounts = history.revisions.filter((rev) => rev.additions + rev.deletions === 0 && rev.n !== 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(to('/history/'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'scrollWidth').toBeLessThanOrEqual(390);

  const table = page.locator('table.history');
  await expect(table).toHaveAttribute('role', 'table');
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(history.count);

  // Every row: the revision link, its date, its note and the counts are visible and inside the viewport width.
  const boxes = await rows.evaluateAll((nodes) =>
    nodes.map((row) => {
      const right = (selector: string) => {
        const el = row.querySelector(selector);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return getComputedStyle(el).display === 'none' || box.width === 0 ? null : Math.round(box.right);
      };
      return {
        n: row.querySelector('th a')?.textContent?.trim() ?? '',
        link: right('th a'),
        date: right('.history__date time'),
        note: right('.history__note'),
        plus: right('.history__plus'),
        kb: right('.history__kb'),
        view: right('.history__view'),
      };
    }),
  );
  for (const box of boxes) {
    expect(box.link, `revision ${box.n} link`).not.toBeNull();
    expect(box.date, `revision ${box.n} date`).not.toBeNull();
    expect(box.note, `revision ${box.n} note`).not.toBeNull();
    for (const [name, right] of Object.entries(box)) {
      if (typeof right === 'number') expect(right, `revision ${box.n} ${name} right edge`).toBeLessThanOrEqual(390);
    }
  }
  // Thumb-sized controls: the whole "Revision n" label is the link, ≥ 32 px tall and ≥ 90 px wide;
  // Diff and GitHub are each ≥ 32 px tall with clear space between their two hit areas.
  const taps = await rows.evaluateAll((nodes) =>
    nodes.map((row) => {
      const size = (el: Element | null) => {
        const box = el!.getBoundingClientRect();
        return { w: box.width, h: box.height, x: box.x, right: box.right };
      };
      const [diff, github] = [...row.querySelectorAll('.history__view a')].map(size);
      return { n: row.querySelector('th a')?.textContent?.trim() ?? '', link: size(row.querySelector('th a')), diff, github };
    }),
  );
  for (const tap of taps) {
    expect(tap.link.h, `revision ${tap.n} link height`).toBeGreaterThanOrEqual(32);
    expect(tap.link.w, `revision ${tap.n} link width`).toBeGreaterThanOrEqual(90);
    expect(tap.diff.h, `revision ${tap.n} Diff height`).toBeGreaterThanOrEqual(32);
    expect(tap.github.h, `revision ${tap.n} GitHub height`).toBeGreaterThanOrEqual(32);
    expect(tap.github.x - tap.diff.right, `revision ${tap.n} gap between Diff and GitHub`).toBeGreaterThanOrEqual(8);
  }
  // Nothing on the page is set under 14 px: timestamps and the chart's labels are 0.85rem.
  for (const selector of ['.history__time', 'text.size-chart__label', 'text.size-chart__value']) {
    const fontSize = await page.locator(selector).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize, `${selector} font-size`).toBeGreaterThanOrEqual(14);
  }
  // A row GitHub gives no counts for hides its `—` cells instead of showing "+— −—" (none in today's data).
  for (const rev of noCounts) {
    await expect(rows.nth(rev.n - 1).locator('.history__plus'), `revision ${rev.n} + cell`).toBeHidden();
  }
  expect(boxes[0]?.plus, 'the first revision still shows its counts').not.toBeNull();
  await expect(rows.nth(2).locator('.history__plus')).toHaveClass(/\bnum\b/);
  await expect(rows.nth(2).locator('.history__plus')).not.toHaveClass(/\bis-empty\b/);

  // The header row is for assistive tech only at this width; the caption stays readable.
  await expect(table.locator('thead')).not.toBeInViewport();
  await expect(table.locator('caption')).toBeVisible();

  // The chart's two KB labels stay inside the chart at phone width.
  const chart = await page.locator('svg.size-chart').boundingBox();
  for (const label of await page.locator('svg.size-chart text.size-chart__value').all()) {
    const box = await label.boundingBox();
    expect(box!.x + box!.width, `${await label.textContent()} inside the chart`).toBeLessThanOrEqual(chart!.x + chart!.width);
  }

  // Desktop keeps today's table: eight visible columns.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(to('/history/'));
  await expect(page.locator('table.history')).toHaveCSS('display', 'table');
  const headers = page.locator('table.history thead th');
  await expect(headers).toHaveCount(8);
  for (const header of await headers.all()) await expect(header).toBeVisible();
  await expect(page.locator('table.history tbody tr').nth(2).locator('td')).toHaveCount(7);
});

test('the history table stacks below 1120px and is a real table with thumb-sized links from 1120px', async ({ page }) => {
  test.skip(!present(CONTENT.history), 'gist history not merged yet');
  const table = page.locator('table.history');
  const scrollWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  const scroller = () =>
    page.locator('.history-table .table-scroll').evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  const boxes = (selector: string) => table.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect));

  // The stacked layout: no sideways scroll inside the table's wrapper or on the page, the header row
  // for assistive tech only, and every link thumb-sized. Its width does not depend on the font, so
  // these hold on CI's wider Linux fonts too.
  const expectStacked = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.goto(to('/history/'));
    expect(await scrollWidth(), `${width} scrollWidth`).toBe(width);
    const wrapper = await scroller();
    expect(wrapper.scrollWidth, `${width} .table-scroll overflow`).toBe(wrapper.clientWidth);
    await expect(table.locator('thead')).not.toBeInViewport();

    const revisionLinks = await boxes('tbody th a');
    expect(revisionLinks.length, 'revision links').toBeGreaterThan(0);
    for (const [i, box] of revisionLinks.entries()) {
      expect(box.height, `${width} revision ${i + 1} link height`).toBeGreaterThanOrEqual(32);
      expect(box.width, `${width} revision ${i + 1} link width ("Revision n")`).toBeGreaterThanOrEqual(90);
    }
    const viewLinks = await boxes('.history__view a');
    expect(viewLinks.length, 'Diff and GitHub links').toBe(revisionLinks.length * 2);
    for (const [i, box] of viewLinks.entries()) {
      expect(box.height, `${width} view link ${i} height`).toBeGreaterThanOrEqual(32);
      expect(box.width, `${width} view link ${i} width`).toBeGreaterThanOrEqual(32);
    }
  };
  await expectStacked(768, 1024); // iPad portrait
  await expectStacked(1024, 768); // iPad landscape: the real table would need ≈ 1000 px on Linux fonts, the container is 956

  // Desktop: the eight-column table fits its container (1088 px against ≈ 925 px on Windows fonts, ≈ 1000 on
  // Linux), and the links stay thumb-sized without widening the number column or letting the Diff and
  // GitHub hit areas touch.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(to('/history/'));
  expect(await scrollWidth(), '1280 scrollWidth').toBe(1280);
  const real = await scroller();
  expect(real.scrollWidth, '1280 .table-scroll overflow').toBe(real.clientWidth);
  await expect(table).toHaveCSS('display', 'table');
  const headers = table.locator('thead th');
  await expect(headers).toHaveCount(8);
  for (const header of await headers.all()) await expect(header).toBeVisible();
  const headerHeights = await headers.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
  expect(new Set(headerHeights).size, `1280 header heights (a wrapped header): ${headerHeights.join(', ')}`).toBe(1);

  const rows = await table.locator('tbody tr').evaluateAll((nodes) =>
    nodes.map((row) => {
      const rect = (el: Element | null) => el!.getBoundingClientRect().toJSON() as DOMRect;
      const [diff, github] = Array.from(row.querySelectorAll('.history__view a'), rect);
      return { th: rect(row.querySelector('th')), link: rect(row.querySelector('th a')), diff, github };
    }),
  );
  const intersects = (a: DOMRect, b: DOMRect) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  expect(rows.length, 'rows').toBeGreaterThan(0);
  expect(rows[0].th.width, '1280 number column width').toBeLessThanOrEqual(48);
  for (const [i, row] of rows.entries()) {
    expect(row.link.height, `1280 revision ${i + 1} link height`).toBeGreaterThanOrEqual(32);
    expect(row.diff.height, `1280 revision ${i + 1} Diff height`).toBeGreaterThanOrEqual(32);
    expect(row.github.height, `1280 revision ${i + 1} GitHub height`).toBeGreaterThanOrEqual(32);
    expect(intersects(row.diff, row.github), `1280 revision ${i + 1} Diff and GitHub hit areas overlap`).toBe(false);
  }

  // The edge: the stack up to 1119 px, the real table from 1120, where the container is 1052 px.
  await page.setViewportSize({ width: 1119, height: 900 });
  await page.goto(to('/history/'));
  await expect(table, '1119 stacks').toHaveCSS('display', 'grid');
  await page.setViewportSize({ width: 1120, height: 900 });
  await page.goto(to('/history/'));
  await expect(table, '1120 is a table').toHaveCSS('display', 'table');
  const edge = await scroller();
  expect(edge.scrollWidth, '1120 .table-scroll overflow').toBe(edge.clientWidth);
  expect(await scrollWidth(), '1120 scrollWidth').toBe(1120);
});