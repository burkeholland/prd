import { expect, test } from '@playwright/test';

// The site is published under this base path (astro.config.mjs); see tests/e2e/site.spec.ts.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// Canonical URLs are absolute (astro.config.mjs `site` + `base`) and end in a slash for pages.
const SITE = 'https://burkeholland.github.io';
const ROUTES = ['/', '/sample/', '/guide/', '/walkthrough/', '/template/'];
const canonicalOf = (path: string) => `${SITE}${BASE}${path}`;
const OG_IMAGE = `${SITE}${BASE}/og.png`;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('every page has one canonical URL and a matching Open Graph / Twitter card', async ({ page }) => {
  for (const path of ROUTES) {
    await page.goto(to(path));
    const expected = canonicalOf(path);

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical, `${path} canonical count`).toHaveCount(1);
    await expect(canonical, `${path} canonical href`).toHaveAttribute('href', expected);

    const meta = async (selector: string) => page.locator(`head ${selector}`).getAttribute('content');
    expect(await meta('meta[property="og:url"]'), `${path} og:url`).toBe(expected);
    expect(await meta('meta[property="og:title"]'), `${path} og:title`).toBe(await page.title());
    expect(await meta('meta[property="og:image"]'), `${path} og:image`).toBe(OG_IMAGE);
    expect(await meta('meta[name="twitter:card"]'), `${path} twitter:card`).toBe('summary_large_image');
    expect(await meta('meta[name="twitter:image"]'), `${path} twitter:image`).toBe(OG_IMAGE);
    // Locators auto-wait for a match, so an absent tag is asserted by count, not by attribute.
    await expect(page.locator('meta[name="robots"]'), `${path} must be indexable`).toHaveCount(0);
  }
});

test('og.png is served as a 1200×630 PNG under 200 KB', async ({ request }) => {
  const response = await request.get(to('/og.png'));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');

  const body = await response.body();
  expect(body.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature').toBe(true);
  // IHDR is the first chunk: width and height are big-endian at bytes 16–23.
  expect(body.readUInt32BE(16), 'IHDR width').toBe(1200);
  expect(body.readUInt32BE(20), 'IHDR height').toBe(630);
  expect(body.length, 'file size').toBeLessThan(200_000);
});

test('the sitemap index points at one sitemap listing exactly the five pages by canonical URL', async ({ request }) => {
  const index = await request.get(to('/sitemap-index.xml'));
  expect(index.status()).toBe(200);
  const indexXml = await index.text();
  expect(indexXml).toContain('sitemap-0.xml');
  const sitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(sitemaps).toEqual([`${SITE}${BASE}/sitemap-0.xml`]);

  const sitemap = await request.get(to('/sitemap-0.xml'));
  expect(sitemap.status()).toBe(200);
  const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locs).toHaveLength(5);
  expect(new Set(locs)).toEqual(new Set(ROUTES.map(canonicalOf)));
  expect(locs.filter((loc) => loc.includes('404')), 'status pages in the sitemap').toEqual([]);
});
