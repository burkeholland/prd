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

  // At the default viewport (1280×720, DPR 1) the browser takes the 760w WebP, not the PNG.
  await page.waitForLoadState('load');
  const currentSrc = await images.first().evaluate((node) => (node as HTMLImageElement).currentSrc);
  expect(currentSrc, 'first screenshot currentSrc').toMatch(/-760\.webp$/);

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

test('pressing Tab once on / focuses the skip link', async ({ page }) => {
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
    revisions: { n: number; additions: number; deletions: number }[];
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

  await expect(page.locator('svg.size-chart text')).toHaveCount(history.count);
  await expect(page.locator('svg.size-chart rect')).toHaveCount(history.count);
  await expect(page.locator('script')).toHaveCount(0);
});