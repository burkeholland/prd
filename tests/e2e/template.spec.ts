import { expect, test, type Page } from '@playwright/test';
import { PRD_TEMPLATE, serializeBlankPrdMarkdown } from '../../src/lib/prd-template';
import { PRD_TEMPLATE_ALIASES } from '../../src/lib/prd-template-compat';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const sections = PRD_TEMPLATE.sections;
const blankMarkdown = serializeBlankPrdMarkdown();
const blankSections = blankMarkdown.split(/(?=^## )/m).slice(1).map((text) => text.trimEnd());

/** Native clipboard reads are Chromium-only; exercise the UI with a stub on every engine too. */
const readClipboard = async (page: Page) =>
  (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

const stubClipboard = async (page: Page) => {
  await page.addInitScript(() => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => { copied = text; },
        readText: async () => copied,
      },
    });
  });
};

test('/template/ renders canonical headings, prompts, helper questions, and copyable sections in order', async ({ page }) => {
  const response = await page.goto(to('/template/'));
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main .doc__body')).toHaveCount(1);
  await expect(page.locator('main h2')).toHaveText(sections.map(({ title }) => title));
  expect(await page.locator('main h2').evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(
    sections.map(({ id }) => id),
  );
  await expect(page.locator('.template-prompt')).toHaveText(sections.map(({ prompt }) => prompt));
  await expect(page.locator('.template-section li')).toHaveText(sections.flatMap(({ helperQuestions }) => [...helperQuestions]));
  expect(await page.locator('main .prose pre code').allTextContents()).toEqual(blankSections);
  const buttons = page.locator('button.copy-button');
  await expect(buttons).toHaveCount(sections.length);
  await expect(page.getByRole('button', { name: 'Copy blank Markdown', exact: true })).toHaveCount(1);
  expect(await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual(
    sections.map(({ title }) => `Copy the ${title} section`),
  );
  expect(await page.locator('.code-block').evaluateAll((nodes) =>
    nodes.map((node) => Array.from(node.children, (child) => child.tagName).join('>')),
  )).toEqual(sections.map(() => 'BUTTON>PRE'));
  expect(await page.locator('aside .toc__list a').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href')),
  )).toEqual(sections.map(({ id }) => `#${id}`));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /editor's adaptable PRD template/);
});

test('old and canonical Markdown URLs return identical UTF-8 files from the model', async ({ request }) => {
  const canonical = await request.get(to('/downloads/prd-template.md'));
  const legacy = await request.get(to('/prd-template.md'));
  for (const response of [canonical, legacy]) {
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/markdown');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await response.body());
    expect(text).toBe(blankMarkdown);
    expect(Array.from(text.matchAll(/^# (.+)$/gm), (match) => match[1])).toEqual([PRD_TEMPLATE.defaultTitle]);
    expect(Array.from(text.matchAll(/^## (.+)$/gm), (match) => match[1])).toEqual(sections.map(({ title }) => title));
  }
  expect(await legacy.body()).toEqual(await canonical.body());
});

test('clicking Copy uses the native clipboard, announces success, then resets', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are Chromium-only in Playwright');
  await page.goto(to('/template/'));
  const button = page.locator('button.copy-button').first();
  await button.click();
  await expect(button).toHaveText('Copied');
  await expect(button).toHaveAttribute('data-state', 'copied');
  expect(await readClipboard(page)).toBe(blankSections[0]);
  const status = page.locator('main .copy-status[role="status"]');
  await expect(status).toHaveCount(1);
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText(`Copied the ${sections[0].title} section`);
  await expect(button).toHaveText('Copy', { timeout: 3000 });
  await expect(button).not.toHaveAttribute('data-state');
});

test('keyboard navigation reaches Copy and every button copies its canonical section', async ({ page }) => {
  await stubClipboard(page);
  await page.goto(to('/template/'));
  const firstHeading = page.locator('.template-section .heading-link').first();
  await firstHeading.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#${sections[0].id}$`));
  await firstHeading.focus();
  await page.keyboard.press('Tab');
  const buttons = page.locator('button.copy-button');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(buttons.first()).toHaveText('Copied');
  expect(await readClipboard(page)).toBe(blankSections[0]);

  for (const [index, section] of sections.entries()) {
    if (index === 0) continue;
    await buttons.nth(index).click();
    await expect(buttons.nth(index)).toHaveText('Copied');
    expect(await readClipboard(page)).toBe(blankSections[index]);
    await expect(page.locator('.copy-status')).toHaveText(`Copied the ${section.title} section`);
  }
});

for (const failure of ['unavailable', 'denied'] as const) {
  test(`clipboard ${failure} selects the canonical text and announces the manual copy fallback`, async ({ page }) => {
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: mode === 'unavailable' ? undefined : {
          writeText: async () => { throw new DOMException('Not allowed', 'NotAllowedError'); },
        },
      });
    }, failure);
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto(to('/template/'));
    const button = page.locator('button.copy-button').first();
    await button.click();
    await expect(button).toHaveText('Copy failed');
    await expect(button).not.toHaveAttribute('data-state');
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(blankSections[0]);
    await expect(page.locator('.copy-status')).toHaveText(
      'Copy failed — text selected. Press Ctrl+C or Command+C to copy.',
    );
    const separated = await page.locator('.code-block').first().evaluate((block) => {
      const button = block.querySelector('button')!.getBoundingClientRect();
      const code = block.querySelector('code')!.getBoundingClientRect();
      return button.bottom <= code.top;
    });
    expect(separated, 'failure label stays above the code').toBe(true);
  });
}

test('all legacy fragments land beside their canonical heading with no duplicate IDs', async ({ page }) => {
  await page.goto(to('/template/'));
  const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const [alias, target] of Object.entries(PRD_TEMPLATE_ALIASES)) {
    await page.goto(to(`/template/#${alias}`));
    const destination = page.locator(`[id="${alias}"]`);
    await expect(destination).toHaveCount(1);
    expect(await destination.evaluate((node) => node.tagName)).toBe('SPAN');
    expect(await destination.evaluate((node) => node.closest('section')?.getAttribute('aria-labelledby'))).toBe(target);
    // Instant scrolling and document coordinates also work on short pages and across engines.
    const offset = await destination.evaluate((node, targetId) => {
      window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
      const heading = document.getElementById(targetId)!;
      return Math.abs(heading.getBoundingClientRect().top - node.getBoundingClientRect().top);
    }, target);
    expect(offset, `${alias} points to its section, not the previous one`).toBeLessThanOrEqual(1);
  }
});

for (const width of [320, 390, 1280]) {
  test(`/template/ fits ${width}px with usable actions and no copy/code overlap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(to('/template/'));
    await expect(page.locator('button.copy-button')).toHaveCount(sections.length);
    await expect(page.getByRole('button', { name: 'Copy blank Markdown', exact: true })).toHaveCount(1);
    if (width < 960) await page.locator('.toc--inline summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const actions = await page.locator('main a, main button, main summary').evaluateAll((nodes) =>
      nodes.filter((node) => node.getClientRects().length > 0).map((node) => {
        const { width, height } = node.getBoundingClientRect();
        return { name: node.textContent, width, height };
      }),
    );
    for (const action of actions) {
      expect(action.height, `${action.name} height`).toBeGreaterThanOrEqual(32);
      expect(action.width, `${action.name} width`).toBeGreaterThanOrEqual(32);
    }
    const overlaps = await page.locator('.code-block').evaluateAll((blocks) =>
      blocks.map((block) => {
        const button = block.querySelector('button')!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(block.querySelector('code')!);
        return Array.from(range.getClientRects()).some((glyphs) =>
          glyphs.width > 0 && glyphs.left < button.right && glyphs.right > button.left &&
          glyphs.top < button.bottom && glyphs.bottom > button.top,
        );
      }),
    );
    expect(overlaps).toEqual(sections.map(() => false));
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the full template, section links, and canonical files remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(to('/template/'));
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('main h2')).toHaveText(sections.map(({ title }) => title));
    await expect(page.locator('.template-prompt')).toHaveText(sections.map(({ prompt }) => prompt));
    expect(await page.locator('main pre code').allTextContents()).toEqual(blankSections);
    await expect(page.locator('button.copy-button')).toHaveCount(0);
    await expect(page.locator('button.template-copy-all')).toHaveCount(0);
    await expect(page.locator('.doc__header a.button')).toHaveAttribute('href', to('/'));
    for (const format of ['md', 'docx', 'pdf']) {
      const path = to(`/downloads/prd-template.${format}`);
      await expect(page.locator(`.doc__header a[download][href="${path}"]`)).toBeVisible();
      expect((await page.request.get(path)).status()).toBe(200);
    }
    await page.locator('.toc--inline summary').focus();
    await page.keyboard.press('Enter');
    const lastLink = page.locator('.toc--inline a').last();
    await expect(lastLink).toHaveText(sections.at(-1)!.title);
    await lastLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#${sections.at(-1)!.id}$`));
  });
});

test('other pages expose no template Copy buttons', async ({ page }) => {
  for (const path of ['/', '/sample/', '/guide/', '/walkthrough/']) {
    await page.goto(to(path));
    await expect(page.locator('button.copy-button'), `${path} copy buttons`).toHaveCount(0);
    await expect(page.locator('button.template-copy-all'), `${path} full-template copy buttons`).toHaveCount(0);
  }
});
