import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/sample', label: 'The sample PRD' },
  { href: '/guide', label: 'How to write one' },
  { href: '/walkthrough', label: 'Worked example' },
  { href: '/template', label: 'Template' },
];

// Doc pages and the repo-root content file each one renders. Other tasks add these files;
// a page must show the placeholder while its file is absent and the real body once it exists.
const DOCS = [
  { path: '/guide', file: 'content/guide.md' },
  { path: '/walkthrough', file: 'content/walkthrough.md' },
  { path: '/template', file: 'content/template.md' },
  { path: '/sample', file: 'content/gist/build-the-urlist.md' },
];

const BRAND = 'PRD Field Guide';
const PLACEHOLDER = 'Content is on its way.';

test('home has one h1, three cards and makes no cross-origin requests', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));

  await page.goto('/');

  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Write a PRD an agent can build.');

  const cards = page.locator('a.card');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute('href', '/sample');
  await expect(cards.nth(1)).toHaveAttribute('href', '/guide');
  await expect(cards.nth(2)).toHaveAttribute('href', '/walkthrough');

  await expect(page.locator('nav.site-nav a')).toHaveCount(5);

  const own = new URL(page.url()).origin;
  expect([...origins]).toEqual([own]);
});

test('every nav route responds 200 with a title that starts with its label', async ({ page }) => {
  for (const item of NAV) {
    const response = await page.goto(item.href);
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
    await page.goto(doc.path);

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

test('no horizontal scroll at 320px on / and /sample', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ['/', '/sample']) {
    await page.goto(path);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(320);
  }
});

test('pressing Tab once on / focuses the skip link', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute('href', '#main');
});
