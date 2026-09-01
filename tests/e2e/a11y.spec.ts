import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// Routes come from `src/pages/*.astro` at test time so a page that lands on main later
// (`/history/`) is audited without editing this file. `/nope/` is the 404 page: it answers
// 404 but is audited like the others. Known routes keep the order of the site navigation.
// EXTRA lists pages a dynamic route builds (`src/pages/history/[n].astro`), which discovery cannot see.
const PREFERRED = ['/', '/sample/', '/guide/', '/walkthrough/', '/template/', '/history/'];
const EXTRA = ['/history/13/'];
const NOT_FOUND = '/nope/';

function discoverRoutes(): string[] {
  const names = readdirSync(resolve('src/pages'))
    .filter((file) => file.endsWith('.astro'))
    .map((file) => file.replace(/\.astro$/, ''))
    .filter((name) => name !== '404');
  const routes = new Set(names.map((name) => (name === 'index' ? '/' : `/${name}/`)));
  const ordered = PREFERRED.filter((route) => routes.has(route));
  const extra = [...routes].filter((route) => !PREFERRED.includes(route)).sort();
  return [...ordered, ...extra, ...EXTRA, NOT_FOUND];
}

const ROUTES = discoverRoutes();
const SCHEMES = ['light', 'dark'] as const;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const BLOCKING = new Set(['serious', 'critical']);
const IMPACTS = ['serious', 'critical', 'moderate', 'minor'] as const;

for (const path of ROUTES) {
  for (const colorScheme of SCHEMES) {
    test(`axe: ${path} ${colorScheme} has no serious or critical violations`, async ({ page, browserName }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'axe is DOM/ARIA analysis — one engine is enough; Firefox runs it 1.4× slower and times out',
      );
      await page.emulateMedia({ colorScheme });
      const response = await page.goto(to(path));
      expect(response?.status(), `${path} status`).toBe(path === NOT_FOUND ? 404 : 200);

      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const violations = results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        nodes: violation.nodes.length,
        target: violation.nodes[0]?.target.join(' ') ?? '',
        help: violation.help,
      }));
      await testInfo.attach(`axe ${path} ${colorScheme}`, {
        body: JSON.stringify(violations, null, 2),
        contentType: 'application/json',
      });

      const counts = IMPACTS.map((impact) => {
        const matching = violations.filter((violation) => violation.impact === impact);
        const ids = matching.length ? ` (${matching.map((violation) => violation.id).join(', ')})` : '';
        return `${matching.length} ${impact}${ids}`;
      });
      console.log(`${path} ${colorScheme}: ${counts.join(', ')}`);

      const blocking = violations.filter((violation) => BLOCKING.has(violation.impact));
      expect(blocking, `${path} ${colorScheme} serious/critical axe violations`).toEqual([]);
    });
  }
}

/** The element that has focus, with enough detail to name it and to judge its focus ring. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      className: el.className,
      href: el.getAttribute('href'),
      text: (el.textContent ?? '').trim().slice(0, 40),
      inNav: el.matches('nav.site-nav a'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });

test('keyboard: Tab shows the skip link, Enter lands in main, every nav link is reachable with a focus ring', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', "WebKit skips links in sequential focus navigation (Safari's Tab-to-links is off by default)");
  await page.goto(to('/guide/'));

  await page.keyboard.press('Tab');
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute('href', '#main');
  await expect(skipLink).toBeVisible();
  // It sits above the viewport until focused (`transform: translateY(-200%)`) and slides in on `:focus`.
  const box = await skipLink.boundingBox();
  expect(box, 'skip link bounding box').not.toBeNull();
  expect(box!.y, 'skip link top edge is inside the viewport').toBeGreaterThanOrEqual(0);
  expect(box!.height, 'skip link is rendered').toBeGreaterThan(0);
  const skipFocus = await focused(page);
  expect(skipFocus?.outlineStyle, 'skip link focus ring').not.toBe('none');

  await page.keyboard.press('Enter');
  const landing = await page.evaluate(() => {
    const main = document.getElementById('main');
    const active = document.activeElement;
    return {
      onMain: active === main,
      inMain: !!main && !!active && main.contains(active),
      id: (active as HTMLElement | null)?.id ?? '',
      tag: active?.tagName.toLowerCase() ?? '',
    };
  });
  expect(landing.onMain || landing.inMain, `Enter on the skip link moved focus to ${landing.tag}#${landing.id}`).toBe(
    true,
  );

  // The header comes before main in document order, so the nav is on the path from the top of
  // the page: start again and record where each Tab lands.
  await page.goto(to('/guide/'));
  const navHrefs = await page.locator('nav.site-nav a').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href') ?? ''),
  );
  expect(navHrefs.length, 'site nav links').toBeGreaterThanOrEqual(5);

  const sequence: NonNullable<Awaited<ReturnType<typeof focused>>>[] = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const current = await focused(page);
    if (current) sequence.push(current);
  }
  const reached = sequence.filter((entry) => entry.inNav).map((entry) => entry.href);
  expect(reached, 'nav links focused within 15 Tabs').toEqual(navHrefs);

  // global.css `:focus-visible { outline: 3px solid var(--accent) }`: every stop shows an outline.
  const unmarked = sequence.filter((entry) => entry.outlineStyle === 'none' || entry.outlineWidth === '0px');
  expect(unmarked, 'focused elements without a visible focus indicator').toEqual([]);
  expect(sequence[0]?.className, 'first Tab stop').toBe('skip-link');
});

test('sample: every screenshot figure has a caption and an alt that describes it, not a file name', async ({
  page,
}) => {
  await page.goto(to('/sample/'));
  const figures = page.locator('.doc__body figure');
  await expect(figures).toHaveCount(7);

  const details = await figures.evaluateAll((nodes) =>
    nodes.map((figure) => {
      const img = figure.querySelector('img');
      return {
        src: img?.getAttribute('src') ?? '',
        alt: img?.getAttribute('alt'),
        caption: figure.querySelector('figcaption')?.textContent?.trim() ?? '',
      };
    }),
  );
  for (const figure of details) {
    const file = figure.src.split('/').pop() ?? '';
    const stem = file.replace(/\.[a-z0-9]+$/i, '');
    const alt = (figure.alt ?? '').trim();
    expect(figure.caption, `${figure.src} figcaption`).not.toBe('');
    expect(alt, `${figure.src} alt`).not.toBe('');
    expect(alt.toLowerCase(), `${figure.src} alt is the file name`).not.toBe(file.toLowerCase());
    expect(alt.toLowerCase(), `${figure.src} alt is the file stem`).not.toBe(stem.toLowerCase());
    expect(alt, `${figure.src} alt ends in an image extension`).not.toMatch(/\.(png|jpe?g|gif|webp|svg|avif)$/i);
    // GitHub names pasted screenshots "Screenshot 2026-08-31 080518": a timestamp, not a description.
    expect(alt, `${figure.src} alt is a screenshot timestamp`).not.toMatch(/^screen ?shot\b[\s\d:._-]*$/i);
  }
});

test('reflow: nothing scrolls sideways at 640px (200% zoom on a 1280px screen) on /sample/ and /template/', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 800 });
  for (const path of ['/sample/', '/template/']) {
    await page.goto(to(path));
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(640);
  }
});
