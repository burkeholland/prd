import { expect, test } from '@playwright/test';
import { SOCIAL_CARDS } from '../../src/lib/seo';

// The site is published under this base path (astro.config.mjs); see tests/e2e/site.spec.ts.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// Canonical URLs are absolute (astro.config.mjs `site` + `base`) and end in a slash for pages.
const SITE = 'https://burkeholland.github.io';
const SOCIAL_CARD_ROUTES = ['/', '/sample/', '/guide/', '/walkthrough/', '/history/', '/template/'] as const;
const canonicalOf = (path: string) => `${SITE}${BASE}${path}`;
// Each page has its own preview card (src/lib/seo.ts); everything else falls back to the home one.
const imageOf = (file: string) => `${SITE}${BASE}${file}`;
const HOME_IMAGE = imageOf(SOCIAL_CARDS['/'].file);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('every page has one canonical URL and a matching Open Graph / Twitter card', async ({ page }) => {
  for (const path of SOCIAL_CARD_ROUTES) {
    await page.goto(to(path));
    const expected = canonicalOf(path);
    const card = SOCIAL_CARDS[path];
    const image = imageOf(card.file);

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical, `${path} canonical count`).toHaveCount(1);
    await expect(canonical, `${path} canonical href`).toHaveAttribute('href', expected);

    const meta = async (selector: string) => page.locator(`head ${selector}`).getAttribute('content');
    expect(await meta('meta[property="og:url"]'), `${path} og:url`).toBe(expected);
    expect(await meta('meta[property="og:title"]'), `${path} og:title`).toBe(await page.title());
    expect(await meta('meta[property="og:image"]'), `${path} og:image`).toBe(image);
    expect(await meta('meta[property="og:image:alt"]'), `${path} og:image:alt`).toContain(card.title);
    expect(await meta('meta[name="twitter:card"]'), `${path} twitter:card`).toBe('summary_large_image');
    expect(await meta('meta[name="twitter:image"]'), `${path} twitter:image`).toBe(image);
    // Locators auto-wait for a match, so an absent tag is asserted by count, not by attribute.
    await expect(page.locator('meta[name="robots"]'), `${path} must be indexable`).toHaveCount(0);
  }
});

test('the 404 page shares the home card', async ({ page }) => {
  const response = await page.goto(to('/nope/'));
  expect(response?.status()).toBe(404);
  const meta = async (selector: string) => page.locator(`head ${selector}`).getAttribute('content');
  expect(await meta('meta[property="og:image"]')).toBe(HOME_IMAGE);
  expect(await meta('meta[name="twitter:image"]')).toBe(HOME_IMAGE);
});

test('/create/ is a noindex compatibility view without duplicate canonical or social URLs', async ({
  page,
}) => {
  const response = await page.goto(to('/create/'));
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
  await expect(page.locator('[data-prd-editor]')).toHaveCount(1);
});

test('every social card is served as a 1200×630 PNG under 200 KB', async ({ request }) => {
  const files = [...new Set(Object.values(SOCIAL_CARDS).map((card) => card.file))];
  expect(files).toHaveLength(6);
  expect(files).toContain('/og.png');

  for (const file of files) {
    const response = await request.get(to(file));
    expect(response.status(), `${file} status`).toBe(200);
    expect(response.headers()['content-type'], `${file} content-type`).toContain('image/png');

    const body = await response.body();
    expect(body.subarray(0, 8).equals(PNG_SIGNATURE), `${file} PNG signature`).toBe(true);
    // IHDR is the first chunk: width and height are big-endian at bytes 16–23.
    expect(body.readUInt32BE(16), `${file} IHDR width`).toBe(1200);
    expect(body.readUInt32BE(20), `${file} IHDR height`).toBe(630);
    expect(body.length, `${file} file size`).toBeLessThan(200_000);
  }
});

test('the sitemap index points at one sitemap listing exactly the six indexable pages', async ({ request }) => {
  const index = await request.get(to('/sitemap-index.xml'));
  expect(index.status()).toBe(200);
  const indexXml = await index.text();
  expect(indexXml).toContain('sitemap-0.xml');
  const sitemaps = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(sitemaps).toEqual([`${SITE}${BASE}/sitemap-0.xml`]);

  const sitemap = await request.get(to('/sitemap-0.xml'));
  expect(sitemap.status()).toBe(200);
  const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  expect(locs).toHaveLength(6);
  expect(new Set(locs)).toEqual(new Set(SOCIAL_CARD_ROUTES.map(canonicalOf)));
  expect(locs).not.toContain(canonicalOf('/create/'));
  expect(locs.filter((loc) => loc.includes('404')), 'status pages in the sitemap').toEqual([]);
});

// The shared stylesheet is inlined (astro.config.mjs `build.inlineStylesheets: 'always'`): it was every page's
// only render-blocking request (#1522, #1529). One test per page so a change back to `'auto'` (which inlines
// only sheets under 4 KB — ours is 16 KB) names the page it broke. `/history/16/` carries its own scoped
// <style> as well and `/nope/` is the 404; both must still carry the shared rules. Engine-neutral: the check
// reads the <head>, not the layout. Text matchers skip <head> and <style>, so the CSS is read out with evaluate.
const INLINE_CSS_ROUTES = [...SOCIAL_CARD_ROUTES, '/create/', '/history/16/', '/nope/'] as const;
for (const path of INLINE_CSS_ROUTES) {
  test(`${path} inlines the shared stylesheet instead of linking it`, async ({ page }) => {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(path === '/nope/' ? 404 : 200);
    await expect(page.locator('link[rel="stylesheet"]'), `${path} external stylesheets`).toHaveCount(0);
    await expect(page.locator('link[rel="preload"][as="style"]'), `${path} stylesheet preloads`).toHaveCount(0);
    const styles = await page.locator('head style').evaluateAll((els) => els.map((el) => el.textContent ?? ''));
    expect(styles.length, `${path} inline <style> count`).toBeGreaterThanOrEqual(1);
    // Rules only global.css has: the nav row and the page grid. A scoped page <style> alone would not carry them.
    const shared = styles.filter((css) => css.includes('.site-nav') && css.includes('.site-header'));
    expect(shared, `${path} a <style> carries the shared rules`).toHaveLength(1);
    // Nothing of the shared sheet is left external either: no `_astro/*.css` in the document at all.
    expect(await page.content(), `${path} references a bundled CSS file`).not.toMatch(/_astro\/[^"']+\.css/);
  });
}
