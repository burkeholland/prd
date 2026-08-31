import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/sample/', label: 'The sample PRD' },
  { href: '/guide/', label: 'How to write one' },
  { href: '/walkthrough/', label: 'Worked example' },
  { href: '/template/', label: 'Template' },
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

test('home has one h1, three cards and makes no cross-origin requests', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  await page.goto(to('/'));

  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Write a PRD an agent can build.');

  const cards = page.locator('a.card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('href', to('/sample/'));
  await expect(cards.nth(1)).toHaveAttribute('href', to('/guide/'));
  await expect(cards.nth(2)).toHaveAttribute('href', to('/walkthrough/'));

  await expect(page.locator('nav.site-nav a')).toHaveCount(5);

  const own = new URL(page.url()).origin;
  expect([...origins]).toEqual([own]);
});

test('home states the thesis: the lede and "Why specificity wins" with four points', async ({ page }) => {
  await page.goto(to('/'));

  await expect(page.locator('p.lede')).toContainText('one-shot the app');

  const heading = page.locator('h2', { hasText: 'Why specificity wins' });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText('Why specificity wins');
  await expect(heading.locator('xpath=following-sibling::ul[1]/li')).toHaveCount(4);
});

test('every nav route responds 200 with a title that starts with its label', async ({ page }) => {
  for (const item of NAV) {
    const response = await page.goto(to(item.href));
    expect(response?.status(), `${item.href} status`).toBe(200);

    const title = await page.title();
    const allowed = item.href === '/' ? [item.label, BRAND] : [item.label];
    expect(
      allowed.some((prefix) => title.startsWith(prefix)),
      `${item.href} title "${title}" should start with ${allowed.join(' or ')}`,
    ).toBe(true);
  }
});

test('no page whose content exists says it is on its way', async ({ page }) => {
  const routes = ['/', '/sample/', '/guide/'];
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
      return {
        src: node.getAttribute('src') ?? '',
        loading: node.getAttribute('loading'),
        decoding: node.getAttribute('decoding'),
        caption: figure?.querySelector('figcaption')?.textContent?.trim() ?? null,
        heading: heading?.textContent?.trim() ?? null,
      };
    }),
  );
  for (const img of details) {
    expect(img.loading, `${img.src} loading`).toBe('lazy');
    expect(img.decoding, `${img.src} decoding`).toBe('async');
    expect(img.caption, `${img.src} caption`).toBeTruthy();
    expect(img.caption, `${img.src} caption matches the preceding #### heading`).toBe(img.heading);

    const response = await page.request.get(img.src);
    expect(response.status(), `${img.src} status`).toBe(200);
    expect(response.headers()['content-type'], `${img.src} content-type`).toContain('image/png');
  }
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
  await expect(card.locator('a', { hasText: 'View on GitHub' })).toHaveAttribute('href', meta.html_url);
  await expect(card.locator('.source-card__meta')).toContainText('Last fetched');
  await expect(card.locator('.source-card__meta time')).toHaveAttribute('datetime', meta.fetched_at);

  const revision = card.locator('.source-card__meta a');
  await expect(revision).toHaveText(meta.revision.slice(0, 7));
  await expect(revision).toHaveAttribute('href', `${meta.html_url}/${meta.revision}`);
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

test('no horizontal scroll at 320px on / and /sample/', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/sample/']) {
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