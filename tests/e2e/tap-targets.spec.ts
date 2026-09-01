import { expect, test, type Locator, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/guide/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

const TABLET_PORTRAIT = { width: 768, height: 1024 };
const TABLET_LANDSCAPE = { width: 1024, height: 768 };
const MIN_TAP = 32;

/** The sidebar TOC's scroll state and where its last link sits relative to the aside's own box. */
const sidebarGeometry = (aside: Locator) =>
  aside.evaluate((node) => {
    const links = node.querySelectorAll<HTMLAnchorElement>('.toc__list a');
    const last = links[links.length - 1];
    const fade = getComputedStyle(node, '::after');
    return {
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      scrollTop: node.scrollTop,
      asideBottom: node.getBoundingClientRect().bottom,
      lastLinkBottom: last.getBoundingClientRect().bottom,
      links: links.length,
      fade: { position: fade.position, height: parseFloat(fade.height), backgroundImage: fade.backgroundImage },
    };
  });

const scrollAsideToEnd = (aside: Locator) => aside.evaluate((node) => node.scrollTo(0, node.scrollHeight));

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));

test('1024×768: the sidebar TOC fades out at its end while links hide below it, and clears the last link once scrolled', async ({
  page,
}) => {
  await page.setViewportSize(TABLET_LANDSCAPE);

  // /sample/ has 20 links: the aside is capped at 100vh − 3rem (717 px) and its list is taller than that.
  await page.goto(to('/sample/'));
  const aside = page.locator('aside.toc--sidebar');
  const resting = await sidebarGeometry(aside);
  expect(resting.links, 'sample TOC links').toBe(20);
  expect(resting.scrollHeight, 'the list is taller than the aside').toBeGreaterThan(resting.clientHeight);
  expect(resting.scrollTop, 'the aside starts unscrolled').toBe(0);
  // The end fade is the aside's own last child, stuck to the bottom edge of its scrollport: no script.
  expect(resting.fade.position, '::after position').toBe('sticky');
  expect(resting.fade.backgroundImage, '::after paints a gradient').toContain('linear-gradient');
  expect(resting.fade.height, '::after height (2rem)').toBeGreaterThanOrEqual(MIN_TAP);
  // At rest the last link ("Completion") is below the aside's bottom edge, i.e. hidden under the fade.
  expect(resting.lastLinkBottom, 'last link is hidden at rest').toBeGreaterThan(resting.asideBottom);

  // Scrolled to the end the fade sits under the last link over the page background: the link is readable.
  await scrollAsideToEnd(aside);
  const scrolled = await sidebarGeometry(aside);
  expect(scrolled.scrollTop, 'the aside scrolled').toBeGreaterThan(0);
  expect(scrolled.lastLinkBottom, 'last link clear of the 2rem fade at the end').toBeLessThanOrEqual(
    scrolled.asideBottom - MIN_TAP,
  );

  // /guide/ has 13 links. With Segoe UI / Arial metrics they fit under the 717 px cap with the fade
  // (717 / 717 measured); a wider system font can wrap one more line, so the "fits" case is asserted
  // at a height every sans-serif fits and this size checks only that the fade never hides the last link.
  await page.goto(to('/guide/'));
  const guide = await sidebarGeometry(aside);
  expect(guide.links, 'guide TOC links').toBe(13);
  expect(guide.fade.position, 'guide ::after position').toBe('sticky');
  await scrollAsideToEnd(aside);
  const guideEnd = await sidebarGeometry(aside);
  expect(guideEnd.lastLinkBottom, 'guide last link clear of the fade').toBeLessThanOrEqual(guideEnd.asideBottom - MIN_TAP);

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(to('/guide/'));
  const fits = await sidebarGeometry(aside);
  expect(fits.scrollHeight, 'the fade adds no scrolling where the list fits').toBe(fits.clientHeight);
  expect(fits.lastLinkBottom, 'the fade sits below the last link, over nothing').toBeLessThanOrEqual(
    fits.asideBottom - MIN_TAP,
  );
});

test('768×1024: the "On this page" summary is thumb-sized without growing the closed box, and its links stay ≥ 32 px', async ({
  page,
}) => {
  await page.setViewportSize(TABLET_PORTRAIT);
  await page.goto(to('/guide/'));

  const details = page.locator('details.toc--inline');
  const summary = details.locator('> summary');
  await expect(details).not.toHaveAttribute('open');
  const closed = await details.evaluate((node) => node.getBoundingClientRect().height);
  const summaryBox = await summary.evaluate((node) => node.getBoundingClientRect());
  expect(summaryBox.height, 'summary tap target').toBeGreaterThanOrEqual(MIN_TAP);
  // The summary's padding is cancelled by an equal negative margin, so the closed box is the height it
  // had before the padding: 1px border + 0.75rem padding + one 1.6-line of 17px text, each side.
  expect(closed, 'closed details height (unchanged from main)').toBeCloseTo(54.6875, 1);

  for (const [path, count] of [
    ['/guide/', 13],
    ['/walkthrough/', 18],
  ] as const) {
    await page.goto(to(path));
    await page.locator('details.toc--inline > summary').click();
    await expect(page.locator('details.toc--inline')).toHaveAttribute('open');
    const heights = await page
      .locator('details.toc--inline .toc__list a')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(heights.length, `${path} inline TOC links`).toBe(count);
    for (const height of heights) expect(height, `${path} TOC link height`).toBeGreaterThanOrEqual(MIN_TAP);
  }
});

test('768×1024: the 404 page\'s six way-home links and the home "The template →" link are ≥ 32 px tall', async ({
  page,
}) => {
  await page.setViewportSize(TABLET_PORTRAIT);

  const response = await page.goto(to('/nope/'));
  expect(response?.status(), 'unknown paths get the 404 page').toBe(404);
  const links = await page.locator('.doc__body ul a').evaluateAll((nodes) =>
    nodes.map((node) => ({ text: node.textContent ?? '', height: node.getBoundingClientRect().height })),
  );
  expect(links.length, '404 way-home links').toBe(6);
  for (const link of links) expect(link.height, `"${link.text}" tap target`).toBeGreaterThanOrEqual(MIN_TAP);
  expect(await noSidewaysScroll(page), '404 page has no sideways scroll').toMatchObject({ scrollWidth: 768, viewport: 768 });

  await page.goto(to('/'));
  const ready = await page.locator('p.ready').evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    link: node.querySelector('a')?.getBoundingClientRect().height ?? 0,
  }));
  expect(ready.link, 'template link tap target').toBeGreaterThanOrEqual(MIN_TAP);
  // The padding is cancelled by an equal negative margin: the line stays a single 0.95rem × 1.6 line.
  expect(ready.height, 'p.ready stays one line').toBeLessThanOrEqual(30);
  expect(await noSidewaysScroll(page), 'home has no sideways scroll').toMatchObject({ scrollWidth: 768, viewport: 768 });
});
