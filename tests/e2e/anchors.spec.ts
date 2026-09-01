import { expect, test, type Page } from '@playwright/test';

// The site is published under this base path (astro.config.mjs). Playwright resolves
// `page.goto('/sample/')` against the origin only, so every path goes through `to()`.
const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;

// Every page that renders markdown through src/lib/rehype-anchors.mjs.
const DOC_PAGES = ['/sample/', '/guide/', '/walkthrough/', '/template/'];
const HEADINGS = '.prose :is(h2, h3, h4)[id]';
const LINKS = '.prose :is(h2, h3, h4) > a.heading-link';

/** The permalink of every h2–h4 on the page, with the heading it sits in. */
const anchorsOn = (page: Page) =>
  page.locator(LINKS).evaluateAll((nodes) =>
    nodes.map((node) => {
      const heading = node.parentElement as HTMLElement;
      return {
        tag: heading.tagName,
        id: heading.id,
        href: node.getAttribute('href') ?? '',
        headingText: heading.textContent ?? '',
        linkText: node.textContent ?? '',
        siblings: heading.childNodes.length,
        nestedLinks: node.querySelectorAll('a').length,
      };
    }),
  );

for (const path of DOC_PAGES) {
  test(`${path} links every h2–h4 to its own id and changes no heading text`, async ({ page }) => {
    await page.goto(to(path));

    const headings = await page.locator(HEADINGS).count();
    const links = await page.locator(LINKS).count();
    expect(headings, `${path} headings with an id`).toBeGreaterThan(0);
    expect(links, `${path} heading links`).toBe(headings);

    for (const anchor of await anchorsOn(page)) {
      expect(anchor.id, `${anchor.tag} id`).not.toBe('');
      expect(anchor.href, `${anchor.tag}#${anchor.id} href`).toBe(`#${anchor.id}`);
      // The link is the heading's only child and carries all of its text: `textContent` is unchanged.
      expect(anchor.siblings, `${anchor.tag}#${anchor.id} child nodes`).toBe(1);
      expect(anchor.linkText, `${anchor.tag}#${anchor.id} text`).toBe(anchor.headingText);
      expect(anchor.linkText.trim(), `${anchor.tag}#${anchor.id} text is not empty`).not.toBe('');
      expect(anchor.linkText, `${anchor.tag}#${anchor.id} text carries no # glyph`).not.toMatch(/#\s*$/);
      expect(anchor.nestedLinks, `${anchor.tag}#${anchor.id} nested links`).toBe(0);
    }

    // h1 is the document title, never a permalink.
    await expect(page.locator('.prose h1 > a.heading-link'), `${path} h1 link`).toHaveCount(0);
  });
}

test('the # appears on hover only, in the accent colour, and vanishes again', async ({ page }) => {
  await page.goto(to('/sample/'));
  await page.mouse.move(0, 0);

  const heading = page.locator('.prose h2[id]').first();
  const link = heading.locator('> a.heading-link');
  const after = () =>
    link.evaluate((node) => {
      const style = getComputedStyle(node, '::after');
      return { opacity: style.opacity, content: style.content, color: style.color };
    });

  const resting = await after();
  expect(resting.opacity, 'resting opacity').toBe('0');
  expect(resting.content, 'the glyph is a #').toContain('#');
  // The link itself looks like the heading: same colour, no underline.
  const styles = await link.evaluate((node) => ({
    color: getComputedStyle(node).color,
    headingColor: getComputedStyle(node.parentElement as Element).color,
    decoration: getComputedStyle(node).textDecorationLine,
  }));
  expect(styles.color).toBe(styles.headingColor);
  expect(styles.decoration).toBe('none');

  await heading.hover();
  await expect.poll(async () => (await after()).opacity, { message: 'hovered opacity' }).toBe('1');
  const hovered = await after();
  expect(hovered.color, 'the # takes the accent colour, not the heading text colour').not.toBe(styles.headingColor);

  await page.mouse.move(0, 0);
  await expect.poll(async () => (await after()).opacity, { message: 'opacity after the pointer leaves' }).toBe('0');
});

test('focusing a heading link and pressing Enter puts its id in the URL', async ({ page }) => {
  await page.goto(to('/sample/'));

  const heading = page.locator('.prose h2[id]').nth(1);
  const id = await heading.getAttribute('id');
  expect(id).toBeTruthy();

  const link = heading.locator('> a.heading-link');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');

  await expect.poll(() => page.evaluate(() => location.hash), { message: 'location.hash' }).toBe(`#${id}`);
  expect(new URL(page.url()).pathname).toBe(to('/sample/'));
});

test('the table of contents still points at the same ids the permalinks use', async ({ page }) => {
  for (const path of ['/sample/', '/guide/']) {
    await page.goto(to(path));

    const tocHrefs = await page
      .locator('aside.toc--sidebar .toc__list a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    expect(tocHrefs.length, `${path} TOC links`).toBeGreaterThan(0);

    const permalinks = new Set((await anchorsOn(page)).map((anchor) => anchor.href));
    const missing = tocHrefs.filter((href) => !permalinks.has(href));
    expect(missing, `${path} TOC entries without a matching heading permalink`).toEqual([]);
  }
});

test('in print the heading links show no # and look like plain heading text', async ({ page }) => {
  await page.emulateMedia({ media: 'print' });
  await page.goto(to('/sample/'));

  const printed = await page.locator(LINKS).evaluateAll((nodes) =>
    nodes.map((node) => ({
      id: node.parentElement?.id ?? '',
      after: getComputedStyle(node, '::after').content,
      color: getComputedStyle(node).color,
      headingColor: getComputedStyle(node.parentElement as Element).color,
      decoration: getComputedStyle(node).textDecorationLine,
    })),
  );
  expect(printed.length, 'heading links on the page').toBeGreaterThan(0);
  for (const link of printed) {
    expect(link.after, `#${link.id} ::after in print`).toBe('none');
    expect(link.color, `#${link.id} colour in print`).toBe(link.headingColor);
    expect(link.decoration, `#${link.id} decoration in print`).toBe('none');
  }

  // Back on screen the glyph is there again (transparent until hovered).
  await page.emulateMedia({ media: 'screen' });
  const onScreen = await page.locator(LINKS).first().evaluate((node) => getComputedStyle(node, '::after').content);
  expect(onScreen).toContain('#');
});

test('/template/ copy buttons are still named from the heading text alone', async ({ page }) => {
  await page.goto(to('/template/'));

  const first = page.locator('button.copy-button').first();
  await expect(first).toHaveAttribute('aria-label', 'Copy the Mission and stop condition skeleton');

  const labels = await page
    .locator('button.copy-button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
  for (const label of labels) expect(label, 'no # leaks into a button name').not.toContain('#');
});
