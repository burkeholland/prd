import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// A4 at 96 dpi: 210mm × 297mm. Print media is emulated at this viewport so the `@media print`
// rules apply and the document has exactly one paper width to fit in.
const A4 = { width: 794, height: 1123 };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Scrolls every lazy image into view and waits until it has loaded (or failed). */
async function loadImages(page: Page) {
  await page.locator('.doc__body img').evaluateAll(async (nodes) => {
    for (const img of nodes as HTMLImageElement[]) {
      img.scrollIntoView();
      if (!img.complete) {
        await new Promise((done) => {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
        });
      }
    }
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The print-media assertions shared by the four document pages, then a screen-media guard. */
async function expectPrintsCleanly(page: Page, path: string) {
  await page.setViewportSize(A4);
  await page.emulateMedia({ media: 'print' });
  const response = await page.goto(to(path));
  expect(response?.status(), `${path} status`).toBe(200);

  // Content only: no nav, footer, skip link, table of contents or download links.
  await expect(page.locator('nav.site-nav'), `${path} nav`).toBeHidden();
  await expect(page.locator('.site-header'), `${path} header`).toBeHidden();
  await expect(page.locator('.site-footer'), `${path} footer`).toBeHidden();
  await expect(page.locator('a.skip-link'), `${path} skip link`).toBeHidden();
  await expect(page.locator('aside.toc--sidebar'), `${path} TOC sidebar`).toBeHidden();
  await expect(page.locator('details.toc--inline'), `${path} inline TOC`).toBeHidden();
  await expect(page.locator('.toc:visible'), `${path} visible TOC`).toHaveCount(0);
  await expect(page.locator('.doc__actions:visible, .source-card__links:visible'), `${path} actions`).toHaveCount(0);

  await expect(page.locator('main'), `${path} main`).toBeVisible();
  await expect(page.locator('.doc__body'), `${path} body`).toBeVisible();
  await expect(page.locator('h1'), `${path} h1`).toHaveCount(path === '/sample/' ? 2 : 1);

  // Black on white, 11pt.
  const body = await page.locator('body').evaluate((el) => {
    const style = getComputedStyle(el);
    return { color: style.color, background: style.backgroundColor, fontSize: style.fontSize };
  });
  expect(body.color, `${path} body color`).toBe('rgb(0, 0, 0)');
  expect(body.background, `${path} body background`).toBe('rgb(255, 255, 255)');
  expect(Math.round(parseFloat(body.fontSize)), `${path} body font-size (11pt)`).toBe(15);

  // Nothing wider than the paper: code wraps, tables shrink, URLs break.
  await loadImages(page);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(A4.width);

  // Code blocks wrap and print black on light grey with a grey border, never cut off.
  const pres = await page.locator('.doc__body pre').evaluateAll((nodes) =>
    nodes.map((el) => {
      const style = getComputedStyle(el);
      return {
        whiteSpace: style.whiteSpace,
        overflowX: style.overflowX,
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        cutOff: el.scrollWidth > el.clientWidth,
      };
    }),
  );
  for (const pre of pres) {
    expect(pre.whiteSpace, `${path} pre white-space`).toBe('pre-wrap');
    expect(pre.overflowX, `${path} pre overflow`).toBe('visible');
    expect(pre.color, `${path} pre color`).toBe('rgb(0, 0, 0)');
    expect(pre.background, `${path} pre background`).toBe('rgb(244, 244, 244)');
    expect(pre.border, `${path} pre border`).toBe('rgb(153, 153, 153)');
    expect(pre.radius, `${path} pre corners`).toBe('0px');
    expect(pre.cutOff, `${path} pre content cut off`).toBe(false);
  }

  // Links: internal ones are plain text, external ones are followed by their URL. `main` rather
  // than `.doc__body`: the sample's external links sit in its source-card header. Only rendered
  // links count — the hidden TOC and download links keep their screen colours.
  const links = await page.locator('main a[href]').evaluateAll((nodes) =>
    nodes
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({
        href: el.getAttribute('href') ?? '',
        color: getComputedStyle(el).color,
        parentColor: getComputedStyle(el.parentElement as Element).color,
        decoration: getComputedStyle(el).textDecorationLine,
        after: getComputedStyle(el, '::after').content,
      })),
  );
  for (const link of links) {
    // `color: inherit` — the link is the colour of the text around it, never the accent green.
    expect(link.color, `${path} ${link.href} color`).toBe(link.parentColor);
    expect(link.color, `${path} ${link.href} color`).not.toBe('rgb(15, 110, 86)');
    if (link.href.startsWith('http')) {
      // `content: " (" attr(href) ")"` serialises differently per engine: Chromium joins it into one
      // string `"(https://…)"`, WebKit keeps the list `" (" "https://…" ")"`, and Firefox returns the
      // unresolved `" (" attr(href) ")"` (it cannot resolve attr() in computed style). Strip quotes
      // and whitespace and accept the URL or the attr() reference.
      const after = link.after.replace(/["\s]/g, '');
      expect(after, `${path} ${link.href} ::after`).toMatch(new RegExp(`^\\((${escapeRegExp(link.href)}|attr\\(href\\))\\)$`));
    } else {
      expect(link.decoration, `${path} ${link.href} decoration`).toBe('none');
      expect(link.after, `${path} ${link.href} ::after`).toBe('none');
    }
  }

  // Screen rendering is untouched: the chrome comes back and the palette is the site's own.
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('nav.site-nav'), `${path} nav on screen`).toBeVisible();
  await expect(page.locator('.site-footer'), `${path} footer on screen`).toBeVisible();
  expect(await page.locator('body').evaluate((el) => getComputedStyle(el).color), `${path} screen color`).not.toBe(
    'rgb(0, 0, 0)',
  );
  await page.emulateMedia({ media: 'print' });

  return { pres: pres.length, links: links.length, external: links.filter((l) => l.href.startsWith('http')).length };
}

test('/guide/ prints content only in black on white', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/guide/');
  expect(counts.links, 'links checked').toBeGreaterThan(0);
});

test('/walkthrough/ prints content only in black on white', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/walkthrough/');
  expect(counts.links, 'links checked').toBeGreaterThan(0);
});

test('/template/ prints content only in black on white, without the download button', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/template/');
  expect(counts.pres, 'code blocks checked').toBeGreaterThan(0);
  await expect(page.locator('.doc__actions a.button')).toBeHidden();
});

test('/sample/ prints content only with its seven screenshots', async ({ page }) => {
  const counts = await expectPrintsCleanly(page, '/sample/');
  expect(counts.pres, 'code blocks checked').toBeGreaterThan(0);
  expect(counts.external, 'external links checked').toBeGreaterThan(0);

  const images = page.locator('.doc__body figure img');
  await expect(images).toHaveCount(7);
  for (let i = 0; i < 7; i += 1) {
    await expect(images.nth(i), `screenshot ${i + 1}`).toBeVisible();
  }
  const sizes = await images.evaluateAll((nodes) =>
    (nodes as HTMLImageElement[]).map((img) => ({
      naturalWidth: img.naturalWidth,
      width: img.getBoundingClientRect().width,
      radius: getComputedStyle(img).borderTopLeftRadius,
    })),
  );
  for (const img of sizes) {
    expect(img.naturalWidth, 'screenshot loaded').toBeGreaterThan(0);
    expect(img.width, 'screenshot fits the paper').toBeLessThanOrEqual(A4.width);
    expect(img.radius, 'screenshot corners').toBe('0px');
  }
});

// Last on purpose: saves the sample PRD as an A4 PDF under test-results/ (ignored, never committed) and
// reports its page count and size as evidence. `page.pdf()` exists in Chromium headless only, so the
// CSS assertions above run in every engine and only this half skips elsewhere.
test('/sample/ saves as an A4 PDF', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only in Playwright');
  await page.setViewportSize(A4);
  await page.emulateMedia({ media: 'print' });
  await page.goto(to('/sample/'));
  await loadImages(page);

  const dir = resolve('test-results');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, 'sample.pdf');
  const pdf = await page.pdf({ path, format: 'A4', printBackground: true });

  // Chromium writes its page tree uncompressed: count `/Type /Page` objects (not `/Pages`) and
  // cross-check against the page tree's root `/Count` (the largest; Skia nests intermediate nodes).
  const text = pdf.toString('latin1');
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const count = Math.max(
    0,
    ...Array.from(text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g), (m) => Number(m[1])),
  );
  const message = `sample.pdf: ${pages} A4 pages (page tree /Count ${count}), ${pdf.length} bytes at ${path}`;
  console.log(message);
  testInfo.annotations.push({ type: 'pdf', description: message });

  expect(pdf.length).toBeGreaterThan(10_000);
  expect(count, 'page tree count matches page objects').toBe(pages);
  expect(pages, 'page count').toBeGreaterThanOrEqual(5);
  expect(pages, 'page count').toBeLessThanOrEqual(40);
});
