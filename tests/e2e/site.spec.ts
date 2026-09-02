import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// The brand is the Home link. The nav contains only the site's three primary jobs.
const NAV: { href: string; label: string; title?: string }[] = [
  { href: '/guide/', label: 'Good PRD', title: 'What makes a good PRD' },
  { href: '/sample/', label: 'Example', title: 'Example PRD' },
  { href: '/template/', label: 'Template', title: 'PRD template' },
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

const BRAND = 'PRD Guide';
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

test('home has one heading, one sentence, and exactly three linked choices', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  await page.goto(to('/'));

  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Write a good PRD.');
  await expect(page.locator('p.lede')).toHaveText(
    'A good PRD tells the builder what to make, which decisions are fixed, and how to know when the work is done.',
  );

  const cards = page.locator('a.card');
  await expect(cards).toHaveCount(3);
  expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual([
    to('/guide/'),
    to('/sample/'),
    to('/template/'),
  ]);
  await expect(cards.locator('h2')).toHaveText(['What makes a good PRD', 'Example PRD', 'PRD template']);
  await expect(cards.locator('p')).toHaveText([
    'Seven practical rules for writing requirements that are specific, testable, and complete.',
    'A complete PRD for a small application, with mocks, routes, constraints, and completion checks.',
    'A section-by-section starting point you can copy and adapt.',
  ]);

  await expect(page.locator('nav.site-nav a')).toHaveCount(3);
  await expect(page.locator('nav.site-nav a')).toHaveText(NAV.map((item) => item.label));
  await expect(page.locator('a.brand')).toHaveText(BRAND);
  await expect(page.locator('a.brand')).toHaveAttribute('href', to('/'));

  const own = new URL(page.url()).origin;
  expect([...origins]).toEqual([own]);
});

test('home has no extra sections or personal and performance framing', async ({ page }) => {
  await page.goto(to('/'));

  await expect(page.locator('main > *')).toHaveCount(2);
  await expect(page.locator('.strip, .ready, .different')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toMatch(
    /Burke|Microsoft|one[- ]?(?:shot|pass)|proof|showcase|origin story/i,
  );
});

test('the three-link nav fits at 320px without scrolling or hiding a target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const paths = ['/', ...NAV.map((item) => item.href), '/walkthrough/', '/history/', '/history/3/'];
  for (const path of paths) {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(200);

    const nav = page.locator('nav.site-nav');
    const links = nav.locator('a');
    await expect(links, `${path} nav labels`).toHaveText(NAV.map((item) => item.label));
    const geometry = await nav.evaluate((node) => {
      const list = node.querySelector('ul')!;
      return {
        linkHeights: Array.from(node.querySelectorAll('a'), (link) => link.getBoundingClientRect().height),
        listScrollWidth: list.scrollWidth,
        listClientWidth: list.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(Math.min(...geometry.linkHeights), `${path} nav target height`).toBeGreaterThanOrEqual(32);
    expect(geometry.listScrollWidth, `${path} nav does not scroll`).toBeLessThanOrEqual(geometry.listClientWidth);
    expect(geometry.documentScrollWidth, `${path} page does not scroll`).toBeLessThanOrEqual(geometry.clientWidth);
  }
});

test('public HTML never names the example author', async ({ request }) => {
  for (const path of ['/', ...NAV.map((item) => item.href), '/walkthrough/', '/history/', '/history/3/']) {
    const response = await request.get(to(path));
    expect(response.status(), `${path} status`).toBe(200);
    expect((await response.text()).match(/Burke Holland/g) ?? [], `${path} exact author-name occurrences`).toEqual(
      [],
    );
  }
});

test('every primary route responds 200 with a title that starts with its public content label', async ({ page }) => {
  await page.goto(to('/'));
  expect(await page.title()).toBe('Write a good PRD. · PRD Guide');

  for (const item of NAV) {
    const response = await page.goto(to(item.href));
    expect(response?.status(), `${item.href} status`).toBe(200);

    const title = await page.title();
    const prefix = item.title ?? item.label;
    expect(
      title.startsWith(prefix),
      `${item.href} title "${title}" should start with ${prefix}`,
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
    await expect(page.locator('h1'), `${path} h1 count`).toHaveCount(path === '/sample/' ? 2 : 1);
  }
});

test('the footer has generic links to the example, site source, and issue form', async ({ page }) => {
  await page.goto(to('/'));
  const links = page.locator('footer a');
  await expect(links).toHaveText(['Example source', 'Site source', 'Report a problem']);
  await expect(links.nth(0)).toHaveAttribute(
    'href',
    'https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817',
  );
  await expect(links.nth(1)).toHaveAttribute('href', 'https://github.com/burkeholland/prd');
  await expect(links.nth(2)).toHaveAttribute(
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

  await expect(page.locator('.source-card h1')).toHaveText('Example PRD');
  const h1 = page.locator('.doc__body h1');
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

test('the sample source card has the generic intro, actions, and gist metadata', async ({ page }) => {
  const meta = JSON.parse(readFileSync(resolve(CONTENT.gistMeta), 'utf8')) as {
    html_url: string;
    revision: string;
    fetched_at: string;
  };
  await page.goto(to('/sample/'));

  const card = page.locator('.source-card');
  await expect(card.locator('h1')).toHaveText('Example PRD');
  await expect(card.locator(':scope > p:not(.source-card__meta):not(.copy-prd-status)')).toHaveText([
    'A complete PRD for a link-sharing app, shown exactly as written. It includes mocks, stack choices, routes, data rules, exact interface copy, tests, and completion checks.',
    'The screenshots show the reference product described by the document.',
  ]);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'A complete PRD for a link-sharing app, shown exactly as written. It includes mocks, stack choices, routes, data rules, exact interface copy, tests, and completion checks.',
  );
  await expect(card.locator('.source-card__links a')).toHaveText([
    'View original',
    'Download .md',
    'Revision history',
  ]);
  await expect(card.locator('a', { hasText: 'View original' })).toHaveAttribute('href', meta.html_url);
  await expect(card.locator('.source-card__links a', { hasText: 'Revision history' })).toHaveAttribute(
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

test('the walkthrough preserves its sections and excerpts with neutral, bounded framing', async ({ page }) => {
  test.skip(!present(CONTENT.walkthrough), 'content not merged yet');
  const { headings } = await expectTocResolves(page, '/walkthrough/', 18);
  expect(headings).toBe(18);
  await expect(page.locator('h1')).toHaveText('Example PRD, section by section');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'How each section removes a decision, with an excerpt and a rule you can reuse.',
  );
  await expect(page.locator('.doc__body blockquote')).toHaveCount(17);

  const opening = page.locator('.doc__body > p').first();
  expect((await opening.innerText()).split(/\s+/).filter(Boolean).length, 'opening words').toBeLessThanOrEqual(45);
  await expect(opening.locator('a')).toHaveText(['Example PRD', 'Template']);
  expect(await opening.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual([
    to('/sample/'),
    to('/template/'),
  ]);

  const useLabels = page.locator('.doc__body strong').filter({ hasText: /^Use this$/ });
  await expect(useLabels).toHaveCount(10);
  await expect(page.locator('.doc__body')).not.toContainText(/Steal this/i);
  await expect(page.locator(`.doc__body a[href^="${to('/guide/')}"]`)).toHaveCount(0);

  for (const label of ['What it does', 'Why it works']) {
    const paragraphs = page.locator('.doc__body p').filter({ hasText: new RegExp(`^${label}`) });
    await expect(paragraphs).toHaveCount(10);
    for (const text of await paragraphs.allInnerTexts()) {
      expect(text.split(/\s+/).filter(Boolean).length, `${label} paragraph words`).toBeLessThanOrEqual(90);
    }
  }

  const ending = await page.locator('.doc__body h2').last().evaluate((heading) => {
    const text: string[] = [];
    const hrefs: string[] = [];
    for (let node = heading.nextElementSibling; node; node = node.nextElementSibling) {
      text.push(node.textContent ?? '');
      hrefs.push(...Array.from(node.querySelectorAll('a'), (link) => link.getAttribute('href') ?? ''));
    }
    return { text: text.join(' '), hrefs };
  });
  expect(ending.text.split(/\s+/).filter(Boolean).length, 'ending words').toBeLessThanOrEqual(100);
  expect(ending.hrefs).toEqual([to('/sample/'), to('/template/')]);

  const prose = (await page.locator('.doc__body').innerText()).toLowerCase();
  for (const phrase of ['burke', 'one-shot', 'one shot', 'one pass', 'what to steal']) {
    expect(prose, `"${phrase}" in walkthrough prose`).not.toContain(phrase);
  }
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
  await expect(page.locator('h1')).toHaveText('Revision history');

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

  await expect(page.locator('h1')).toHaveText('Revision history');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    /^\d+ revisions over \d+ days, showing what changed and when\.$/,
  );
  await expect(page.locator('.history-page__header > p')).toHaveCount(2);

  // The factual lede links the example, and the story uses values from history.json.
  const lede = page.locator('.history-page__header p.lede');
  await expect(lede.locator('a', { hasText: 'Example PRD' })).toHaveAttribute('href', to('/sample/'));
  await expect(lede).toContainText(`has ${history.count} revisions`);

  const story = page.locator('.history-page__header .history-page__story');
  await expect(story).toContainText(`The first draft was ${wholeKb(first.bytes)} KB across 32 sections.`);
  await expect(story).toContainText(`Revision 3 reduced it to ${wholeKb(third.bytes)} KB across 13 sections;`);
  await expect(story).toContainText(`bringing the current example to ${wholeKb(shown.bytes)} KB.`);
  await expect(story).toContainText('Open a revision to read the exact change.');

  const prose = (await page.locator('article.history-page').innerText()).toLowerCase();
  for (const phrase of ['burke', 'one-shot', 'one shot', 'one pass', 'what to steal']) {
    expect(prose, `"${phrase}" in history prose`).not.toContain(phrase);
  }

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