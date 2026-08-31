import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

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

// Doc pages and the repo-root content file each one renders. Other tasks add these files;
// a page must show the placeholder while its file is absent and the real body once it exists.
const DOCS = [
  { path: '/guide/', file: 'content/guide.md' },
  { path: '/walkthrough/', file: 'content/walkthrough.md' },
  { path: '/template/', file: 'content/template.md' },
  { path: '/sample/', file: 'content/gist/build-the-urlist.md' },
];

const BRAND = 'PRD Field Guide';
const PLACEHOLDER = 'Content is on its way.';

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

test('doc pages show the placeholder while content is absent and the body once it exists', async ({ page }) => {
  for (const doc of DOCS) {
    const present = existsSync(resolve(doc.file));
    await page.goto(to(doc.path));

    const placeholder = page.locator('p.placeholder');
    const body = page.locator('.doc__body');
    await expect(page.locator('h1'), `${doc.path} h1 count`).toHaveCount(1);

    if (present) {
      await expect(placeholder, `${doc.path} should render ${doc.file}`).toHaveCount(0);
      expect(await body.locator('h2').count(), `${doc.path} rendered headings`).toBeGreaterThan(0);
      await expect(page.locator('aside.toc--sidebar'), `${doc.path} table of contents`).toBeVisible();
    } else {
      await expect(placeholder, `${doc.path} placeholder`).toHaveText(PLACEHOLDER);
      await expect(placeholder).toBeVisible();
    }
  }
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

  const loaded = await images.evaluateAll((nodes) =>
    nodes.map((node) => {
      const img = node as HTMLImageElement;
      return { src: img.getAttribute('src') ?? '', naturalWidth: img.naturalWidth };
    }),
  );
  for (const img of loaded) {
    expect(img.src, 'screenshot src').toMatch(new RegExp(`^${BASE}/mocks/`));
    expect(img.naturalWidth, `${img.src} loaded`).toBeGreaterThan(0);
  }
});
