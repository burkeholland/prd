import { expect, test, type Page } from '@playwright/test';
import {
  PRD_EDITOR_STORAGE_KEY,
  PRD_EDITOR_PAYLOAD_VERSION,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const CREATE_PATH = '/prd/';

const sectionField = (page: Page, index: number) =>
  page.locator('textarea').nth(index);

test.beforeEach(async ({ page }) => {
  await page.goto(CREATE_PATH);
  await page.evaluate((key) => localStorage.removeItem(key), PRD_EDITOR_STORAGE_KEY);
  await page.reload();
});

test('renders one editor with the canonical heading, 12 optional section fields, six downloads, and status regions', async ({
  page,
}) => {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Create a product requirements document');
  await expect(page.locator('[data-prd-editor]')).toHaveCount(1);
  await expect(page.locator('.editor-lead')).toHaveText(
    'Use this template as a starting point. Add, remove, or change sections to fit your project.',
  );
  await expect(page.locator('.editor-privacy')).toHaveText(
    'Your draft stays in this browser unless you download it.',
  );

  const title = page.locator('input#document-title');
  await expect(page.locator('input')).toHaveCount(1);
  await expect(title).toHaveCount(1);
  await expect(page.locator('label[for="document-title"] > span').first()).toHaveText('Document title');
  await expect(page.locator('label[for="document-title"] .field-state')).toHaveText('Optional');

  const textareas = page.locator('textarea');
  await expect(textareas).toHaveCount(12);
  await expect(page.locator('.editor-outline a')).toHaveCount(12);
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    const field = sectionField(page, index);
    await expect(field).toHaveAttribute('id', `section-input-${section.id}`);
    await expect(page.locator(`label[for="section-input-${section.id}"]`)).toContainText(
      section.title,
    );
    await expect(page.locator(`#section-prompt-${section.id}`)).toHaveText(
      section.prompt,
    );
    await expect(field).toHaveAttribute(
      'aria-describedby',
      `section-prompt-${section.id} section-questions-${section.id}`,
    );
    await expect(
      page.locator(`label[for="section-input-${section.id}"] .field-state`),
    ).toHaveText('Optional');
  }

  await expect(page.locator('[data-export-format]')).toHaveCount(3);
  await expect(page.locator('.editor-downloads .editor-blank-links a[download]')).toHaveCount(3);
  await expect(page.locator('#download-heading')).toHaveText('Download your PRD');
  await expect(page.locator('.editor-downloads h3')).toHaveText('Or start with a blank file');
  await expect(page.locator('.hero, .cards, a.card')).toHaveCount(0);

  const liveRegions = page.locator('[aria-live="polite"]');
  await expect(liveRegions).toHaveCount(2);
  await expect(page.locator('#save-status')).toHaveAttribute('role', 'status');
  await expect(page.locator('#download-status')).toHaveAttribute('role', 'status');
});

test('automatically saves and restores the title and all 12 section values after reload', async ({
  page,
}) => {
  await page.locator('#document-title').fill('Restored launch plan');
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await sectionField(page, index).fill(`Saved content for ${section.id}`);
  }

  await expect(page.locator('#completion-count')).toHaveText(
    '12 of 12 sections completed',
  );
  await expect(page.locator('#save-status')).toContainText(
    'Draft saved automatically in this browser at',
  );

  await page.reload();
  await expect(page.locator('#save-status')).toContainText(
    'Draft restored from this browser.',
  );
  await expect(page.locator('#document-title')).toHaveValue('Restored launch plan');
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await expect(sectionField(page, index)).toHaveValue(
      `Saved content for ${section.id}`,
    );
  }
});

test('Save draft immediately writes a complete versioned payload and visible timestamp', async ({
  page,
}) => {
  await page.locator('#document-title').fill('Explicit save');
  await sectionField(page, 0).fill('A deliberate outcome.');
  await page.locator('#save-draft').click();

  await expect(page.locator('#save-status')).toContainText(
    'Draft saved in this browser at',
  );
  const payload = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null'),
    PRD_EDITOR_STORAGE_KEY,
  );
  expect(payload.version).toBe(PRD_EDITOR_PAYLOAD_VERSION);
  expect(payload.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(payload.state.title).toBe('Explicit save');
  expect(Object.keys(payload.state.values)).toEqual(
    PRD_TEMPLATE_SECTIONS.map((section) => section.id),
  );
  expect(payload.state.values['summary-outcome']).toBe('A deliberate outcome.');
});

for (const scenario of [
  {
    name: 'corrupt JSON',
    value: '{not json',
    message: 'saved draft in this browser is damaged and was not restored',
  },
  {
    name: 'an unsupported payload version',
    value: JSON.stringify({
      version: 99,
      savedAt: '2026-09-02T18:00:00.000Z',
      state: { title: 'Do not restore', values: {} },
    }),
    message: 'saved draft uses unsupported version 99 and was not restored',
  },
] as const) {
  test(`${scenario.name} shows a recoverable message and blank editable fields`, async ({
    page,
  }) => {
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: PRD_EDITOR_STORAGE_KEY, value: scenario.value },
    );
    await page.reload();

    await expect(page.locator('#save-status')).toContainText(scenario.message);
    await expect(page.locator('#document-title')).toHaveValue('');
    await expect(page.locator('textarea')).toHaveCount(12);
    for (let index = 0; index < PRD_TEMPLATE_SECTIONS.length; index += 1) {
      await expect(sectionField(page, index)).toBeEditable();
    }

    await page.locator('#document-title').fill('Recovered draft');
    await page.locator('#save-draft').click();
    await expect(page.locator('#save-status')).toContainText(
      'Draft saved in this browser at',
    );
  });
}

test('a storage write failure is announced without disabling or clearing fields', async ({
  page,
}) => {
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    };
  });

  const title = page.locator('#document-title');
  const first = sectionField(page, 0);
  await title.fill('Still editable');
  await first.fill('Keep this content visible.');
  await expect(page.locator('#save-status')).toContainText(
    'Draft could not be saved in this browser.',
  );
  await expect(title).toBeEditable();
  await expect(first).toBeEditable();
  await expect(title).toHaveValue('Still editable');
  await expect(first).toHaveValue('Keep this content visible.');
});

test('Start over requires confirmation; cancel preserves content and confirm clears fields and storage', async ({
  page,
}) => {
  await page.locator('#document-title').fill('Keep or clear');
  await sectionField(page, 0).fill('A saved section');
  await page.locator('#save-draft').click();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('removes the local draft from this browser');
    await dialog.dismiss();
  });
  await page.locator('#start-over').click();
  await expect(page.locator('#document-title')).toHaveValue('Keep or clear');
  await expect(sectionField(page, 0)).toHaveValue('A saved section');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY),
  ).not.toBeNull();

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  await expect(page.locator('#document-title')).toHaveValue('');
  for (let index = 0; index < PRD_TEMPLATE_SECTIONS.length; index += 1) {
    await expect(sectionField(page, index)).toHaveValue('');
  }
  expect(
    await page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY),
  ).toBeNull();
  await expect(page.locator('#save-status')).toHaveText(
    'Local draft removed. All fields are clear.',
  );
});

test('keyboard flow reaches every field and action, and outline links focus their section fields', async ({
  page,
  browserName,
}) => {
  const firstOutlineLink = page.locator('.editor-outline a').first();
  await firstOutlineLink.focus();
  await page.keyboard.press('Enter');
  await expect(sectionField(page, 0)).toBeFocused();

  await page.locator('#document-title').focus();
  const expectedOrder = [
    'document-title',
    ...PRD_TEMPLATE_SECTIONS.map((section) => `section-input-${section.id}`),
    'download-md',
    'download-docx',
    'download-pdf',
    ...(browserName === 'webkit'
      ? []
      : ['blank-download-md', 'blank-download-docx', 'blank-download-pdf']),
    'save-draft',
    'start-over',
  ];
  const reached = ['document-title'];
  for (let index = 1; index < expectedOrder.length; index += 1) {
    await page.keyboard.press('Tab');
    reached.push(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? ''),
    );
  }
  expect(reached).toEqual(expectedOrder);

  for (const section of PRD_TEMPLATE_SECTIONS) {
    const link = page.locator(`[data-outline-target="${section.id}"]`);
    expect(await link.evaluate((node) => (node as HTMLElement).tabIndex)).toBeGreaterThanOrEqual(
      0,
    );
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`#section-input-${section.id}`)).toBeFocused();
  }
});

test('at 320px the page does not overflow and every outline link and button is at least 32px high', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.reload();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions).toEqual({ scrollWidth: 320, viewport: 320 });

  const targets = page.locator('.editor-outline a, .editor-button');
  await expect(targets).toHaveCount(17);
  const heights = await targets.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().height),
  );
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(32);
});

test('the workbench keeps the editor primary on desktop and remains linear and unobstructed on phones', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const desktop = await page.evaluate(() => {
    const width = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
    return {
      h1: parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
      editor: width('.editor-form'),
      outline: width('.editor-outline'),
      tools: width('.editor-tools'),
      columns: getComputedStyle(document.querySelector('.editor-shell')!).gridTemplateColumns,
    };
  });
  expect(desktop.h1).toBeLessThanOrEqual(36);
  expect(desktop.editor).toBeGreaterThan(desktop.outline);
  expect(desktop.editor).toBeGreaterThan(desktop.tools);
  expect(desktop.columns.split(' ')).toHaveLength(3);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 780 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    const phone = await page.evaluate(() => {
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>(
          'main a[href], main button, main input, main textarea',
        ),
      ).filter((target) => target.getClientRects().length > 0);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        h1: parseFloat(getComputedStyle(document.querySelector('h1')!).fontSize),
        columns: getComputedStyle(document.querySelector('.editor-shell')!).gridTemplateColumns,
        sticky: targets.filter((target) => getComputedStyle(target).position === 'sticky').length,
        undersized: targets
          .map((target) => ({
            id: target.id || target.textContent?.trim() || target.tagName,
            height: target.getBoundingClientRect().height,
          }))
          .filter((target) => target.height < 32),
        outside: targets
          .map((target) => ({
            id: target.id || target.textContent?.trim() || target.tagName,
            left: target.getBoundingClientRect().left,
            right: target.getBoundingClientRect().right,
          }))
          .filter((target) => target.left < 0 || target.right > window.innerWidth + 0.5),
      };
    });
    expect(phone.scrollWidth).toBe(phone.viewport);
    expect(phone.h1).toBeLessThanOrEqual(30);
    expect(phone.columns.split(' ')).toHaveLength(1);
    expect(phone.sticky).toBe(0);
    expect(phone.undersized).toEqual([]);
    expect(phone.outside).toEqual([]);
  }
});

test('without JavaScript the editor is replaced by all three blank template downloads', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(CREATE_PATH);

  await expect(page.locator('[data-prd-editor]')).toBeHidden();
  const downloads = page.locator('.editor-nojs a[download]');
  await expect(downloads).toHaveCount(3);
  await expect(downloads).toHaveText([
    'Download the blank Markdown template',
    'Download the blank Word template',
    'Download the blank PDF template',
  ]);
  expect(await downloads.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual([
    '/prd/downloads/prd-template.md',
    '/prd/downloads/prd-template.docx',
    '/prd/downloads/prd-template.pdf',
  ]);

  await context.close();
});
