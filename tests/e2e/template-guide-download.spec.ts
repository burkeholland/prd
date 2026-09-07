import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  getBlankTemplateSectionMarkdownExamples,
  serializeTemplateGuideMarkdown,
  TEMPLATE_GUIDE_DOWNLOAD_FILENAME,
  TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE,
  type TemplateGuideDownloadEntry,
} from '../../src/lib/template-guide';
import { PRD_TEMPLATE, PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import {
  extractHeadings,
  parseFrontmatter,
} from '../../scripts/lib/content.mjs';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const GUIDE_PATH = to('/downloads/prd-template-guide.md');
const guideLink = (page: Page) =>
  page.getByRole('link', { name: 'Download guide (.md)', exact: true });
const parsed = parseFrontmatter(
  readFileSync(resolve('content/template.md'), 'utf8'),
);
if (
  !parsed.data ||
  !('title' in parsed.data) ||
  typeof parsed.data.title !== 'string' ||
  !('description' in parsed.data) ||
  typeof parsed.data.description !== 'string'
) {
  throw new Error('template guide fixture requires title and description frontmatter');
}
const guideTitle = parsed.data.title;
const guideEntry: TemplateGuideDownloadEntry = {
  data: parsed.data,
  body: parsed.body,
};
const expectedGuideText = serializeTemplateGuideMarkdown(guideEntry);
const expectedGuideBytes = Buffer.from(expectedGuideText);

const downloadBytes = async (download: Download): Promise<Buffer> => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

test('Template downloads the exact prerendered guide and retries with its distinct filename', async ({
  page,
  request,
}) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (error) => diagnostics.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(message.text());
  });
  const response = await page.goto(to('/template/'));
  expect(response?.status()).toBe(200);

  const link = guideLink(page);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', GUIDE_PATH);
  await expect(link).toHaveAttribute('download', TEMPLATE_GUIDE_DOWNLOAD_FILENAME);
  await expect(page.locator('.doc__page-actions')).toHaveCount(1);
  await expect(page.locator('.doc__page-actions button.doc__copy-button')).toHaveCount(1);
  await expect(page.locator('.doc__page-actions button.doc__print-button')).toHaveCount(1);
  await expect(page.locator('.template-download-actions a[download]')).toHaveCount(3);

  const direct = await request.get(GUIDE_PATH);
  expect(direct.status()).toBe(200);
  expect(direct.headers()['content-type']).toBe('text/markdown; charset=utf-8');
  expect(await direct.body()).toEqual(expectedGuideBytes);

  const firstPending = page.waitForEvent('download');
  await link.click();
  const first = await firstPending;
  expect(first.suggestedFilename()).toBe(TEMPLATE_GUIDE_DOWNLOAD_FILENAME);
  expect(await downloadBytes(first)).toEqual(expectedGuideBytes);

  const retryPending = page.waitForEvent('download');
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  const retry = await retryPending;
  expect(retry.suggestedFilename()).toBe(TEMPLATE_GUIDE_DOWNLOAD_FILENAME);
  expect(await downloadBytes(retry)).toEqual(expectedGuideBytes);

  await expect(page).toHaveURL(new RegExp(`${BASE}/template/$`));
  expect(diagnostics).toEqual([]);
});

test('the downloaded guide has exact 12-section model parity in source order', async ({
  request,
}) => {
  const response = await request.get(GUIDE_PATH);
  const markdown = await response.text();
  const blankExamples = getBlankTemplateSectionMarkdownExamples();

  expect(markdown).toBe(expectedGuideText);
  expect(extractHeadings(markdown).map(({ depth, text }) => ({ depth, text }))).toEqual([
    { depth: 1, text: guideTitle },
    ...PRD_TEMPLATE.sections.map(({ title }) => ({ depth: 2, text: title })),
  ]);

  let cursor = markdown.indexOf(
    `${PRD_TEMPLATE.guidance} ${TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE}`,
  );
  for (const [index, section] of PRD_TEMPLATE.sections.entries()) {
    const expectedSection = [
      `## ${section.title}`,
      '',
      section.prompt,
      '',
      ...section.helperQuestions.map((question) => `- ${question}`),
      '',
      '```markdown',
      blankExamples[index],
      '```',
    ].join('\n');
    const sectionIndex = markdown.indexOf(expectedSection, cursor);
    expect(sectionIndex, `${section.id} heading, prompt, questions, and example`).toBeGreaterThan(
      cursor,
    );
    cursor = sectionIndex + expectedSection.length;
  }
});

test('the static guide download is independent of Clipboard, draft state, request bodies, and history', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.defineProperty(window, '__guideClipboardWrites', { value: writes });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    localStorage.setItem('unrelated-private-draft', 'PRIVATE-GUIDE-SENTINEL');
  });
  const requests: { method: string; url: string; body: string | null }[] = [];
  page.on('request', (request) => {
    requests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData(),
    });
  });
  await page.goto(to('/template/'));
  await page.waitForLoadState('networkidle');
  requests.length = 0;
  const before = await page.evaluate(() => ({
    url: location.href,
    historyLength: history.length,
    localStorage: Object.entries(localStorage).sort(),
  }));

  await expect(page.locator('button.doc__copy-button')).toHaveCount(0);
  await expect(page.locator('button.doc__print-button')).toHaveCount(1);
  await expect(guideLink(page)).toHaveCount(1);
  const pending = page.waitForEvent('download');
  await guideLink(page).click();
  await pending;

  expect(await page.evaluate(() => ({
    url: location.href,
    historyLength: history.length,
    localStorage: Object.entries(localStorage).sort(),
    clipboardWrites:
      (window as typeof window & { __guideClipboardWrites: string[] })
        .__guideClipboardWrites,
  }))).toEqual({ ...before, clipboardWrites: [] });
  for (const request of requests) {
    expect(request.method).toBe('GET');
    expect(request.body).toBeNull();
    expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
    expect(new URL(request.url).pathname).toBe(GUIDE_PATH);
  }
});

test('only Template exposes the guide download alongside unchanged content and blank files', async ({
  page,
}) => {
  await page.goto(to('/template/'));
  await expect(guideLink(page)).toHaveCount(1);
  await expect(page.locator('main h2')).toHaveText(
    PRD_TEMPLATE_SECTIONS.map(({ title }) => title),
  );
  await expect(page.locator('aside .toc__list a')).toHaveCount(
    PRD_TEMPLATE_SECTIONS.length,
  );
  for (const format of ['md', 'docx', 'pdf']) {
    await expect(
      page.locator(
        `.template-download-actions a[href="${to(`/downloads/prd-template.${format}`)}"][download]`,
      ),
    ).toHaveCount(1);
  }

  for (const path of ['/', '/sample/', '/guide/', '/walkthrough/', '/history/']) {
    await page.goto(to(path));
    await expect(
      page.locator(`a[href="${GUIDE_PATH}"]`),
      `${path} guide links`,
    ).toHaveCount(0);
  }
});

for (const width of [320, 390, 1280]) {
  test(`Template header actions wrap safely at ${width}px across reader palettes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(to('/template/'));

    for (const theme of ['light', 'dark']) {
      await page.locator('select[data-theme-control]').selectOption(theme);
      for (const textSize of ['default', 'large']) {
        await page
          .locator('select[data-reader-text-size-control]')
          .selectOption(textSize);
        const geometry = await page.locator('.doc__page-actions').evaluate((wrapper) => {
          const viewportWidth = document.documentElement.clientWidth;
          const actions = Array.from(
            wrapper.querySelectorAll<HTMLElement>('a, button'),
            (action) => {
              const rect = action.getBoundingClientRect();
              return {
                label: action.textContent?.trim(),
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              };
            },
          );
          const overlaps = actions.flatMap((action, index) =>
            actions.slice(index + 1).filter((other) =>
              action.left < other.right &&
              action.right > other.left &&
              action.top < other.bottom &&
              action.bottom > other.top,
            ),
          );
          return {
            actions,
            overlapCount: overlaps.length,
            viewportWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
        });

        expect(geometry.actions).toHaveLength(3);
        for (const action of geometry.actions) {
          expect(action.width, `${theme}/${textSize} ${action.label} width`).toBeGreaterThanOrEqual(32);
          expect(action.height, `${theme}/${textSize} ${action.label} height`).toBeGreaterThanOrEqual(32);
          expect(action.left, `${theme}/${textSize} ${action.label} left`).toBeGreaterThanOrEqual(0);
          expect(action.right, `${theme}/${textSize} ${action.label} right`).toBeLessThanOrEqual(
            geometry.viewportWidth,
          );
        }
        expect(geometry.overlapCount, `${theme}/${textSize} overlaps`).toBe(0);
        expect(geometry.scrollWidth, `${theme}/${textSize} overflow`).toBeLessThanOrEqual(
          geometry.viewportWidth,
        );
      }
    }
  });
}

test('print hides the guide with the other page actions', async ({ page }) => {
  await page.goto(to('/template/'));
  await expect(guideLink(page)).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.doc__page-actions')).toBeHidden();
  await expect(guideLink(page)).toBeHidden();
  await expect(page.locator('main h2')).toHaveText(
    PRD_TEMPLATE_SECTIONS.map(({ title }) => title),
  );
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('Template keeps one native guide download with the exact helper bytes', async ({
    page,
  }) => {
    await page.goto(to('/template/'));
    const link = guideLink(page);
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();
    await expect(page.locator('.doc__page-actions button')).toHaveCount(0);

    const pending = page.waitForEvent('download');
    await link.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(TEMPLATE_GUIDE_DOWNLOAD_FILENAME);
    expect(await downloadBytes(download)).toEqual(expectedGuideBytes);
  });
});
