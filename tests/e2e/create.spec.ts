import { expect, test, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  PRD_EDITOR_PAYLOAD_VERSION,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const CREATE_PATH = '/prd/';

const sectionField = (page: Page, index: number) =>
  page.locator('textarea').nth(index);

const storedDraft = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY);

type MutablePrdValues = {
  -readonly [Id in keyof PrdEditorState['values']]: string;
};

const partialDraft = (): PrdEditorState => {
  const blank = createBlankPrdEditorState();
  const values: MutablePrdValues = { ...blank.values };
  for (const index of [0, 1, 3, 11]) {
    const section = PRD_TEMPLATE_SECTIONS[index];
    values[section.id] = `Completed ${section.title}`;
  }
  return { title: blank.title, values };
};

const pendingDraft = (): PrdEditorState => {
  const blank = createBlankPrdEditorState();
  const values: MutablePrdValues = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = ` \tPending field ${index}\nExact value ${index}  `;
  }
  return { title: ' \tPending exact title  ', values };
};

test.beforeEach(async ({ page }) => {
  await page.goto(CREATE_PATH);
  await page.evaluate((key) => localStorage.removeItem(key), PRD_EDITOR_STORAGE_KEY);
  await page.reload();
});

test('immediate navigation synchronously saves one complete pending payload and restores it without a warning', async ({
  page,
}) => {
  const state = pendingDraft();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(
    ({ key, state }) => {
      const countKey = 'prd-test:draft-writes';
      sessionStorage.setItem(countKey, '0');
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (storageKey, value) {
        if (this === localStorage && storageKey === key) {
          const count = Number(sessionStorage.getItem(countKey) ?? '0') + 1;
          set.call(sessionStorage, countKey, String(count));
        }
        return set.call(this, storageKey, value);
      };
      const title = document.querySelector<HTMLInputElement>('#document-title');
      if (!title) throw new Error('Missing title field');
      title.value = state.title;
      title.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      for (const [sectionId, value] of Object.entries(state.values)) {
        const input = document.querySelector<HTMLTextAreaElement>(`#section-input-${sectionId}`);
        if (!input) throw new Error(`Missing ${sectionId} field`);
        input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }
    },
    { key: PRD_EDITOR_STORAGE_KEY, state },
  );
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });

  await page.getByRole('link', { name: 'Example', exact: true }).click();

  await expect(page).toHaveURL('/prd/sample/');
  expect(dialogs).toBe(0);
  const saved = await page.evaluate(
    ({ key, countKey }) => ({
      raw: localStorage.getItem(key),
      writes: Number(sessionStorage.getItem(countKey)),
    }),
    { key: PRD_EDITOR_STORAGE_KEY, countKey: 'prd-test:draft-writes' },
  );
  expect(saved.writes).toBe(1);
  expect(JSON.parse(saved.raw ?? 'null')).toMatchObject({ version: 1, state });

  await page.goBack();

  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'restored');
  expect(
    await page.locator('#prd-editor-form input, #prd-editor-form textarea')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value)
      ),
  ).toEqual([state.title, ...Object.values(state.values)]);
});

for (const path of ['/prd/', '/prd/create/']) {
  test(`${path} restores a partial draft and Continue draft navigates without changing history or saved bytes`, async ({
    page,
  }) => {
    const raw = JSON.stringify(createPrdEditorDraftPayload(partialDraft()));
    await page.goto(path);
    await page.evaluate(
      ({ key, raw }) => localStorage.setItem(key, raw),
      { key: PRD_EDITOR_STORAGE_KEY, raw },
    );
    await page.reload();

    const action = page.getByRole('button', { name: 'Continue draft', exact: true });
    await expect(action).toHaveCount(1);
    await expect(action).toBeVisible();
    await expect(page.locator('#completion-count')).toHaveText('4 of 12 sections completed');
    const historyLength = await page.evaluate(() => history.length);

    await action.focus();
    await page.keyboard.press('Enter');

    const destination = sectionField(page, 2);
    await expect(destination).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}#section-${PRD_TEMPLATE_SECTIONS[2].id}$`));
    await expect.poll(() => page.locator(`#section-${PRD_TEMPLATE_SECTIONS[2].id}`)
      .evaluate((section) => section.getBoundingClientRect().top)).toBeGreaterThanOrEqual(-1);
    expect(await page.locator(`#section-${PRD_TEMPLATE_SECTIONS[2].id}`)
      .evaluate((section) => section.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    expect(await storedDraft(page)).toBe(raw);
    await expect(page.locator('#completion-count')).toHaveText('4 of 12 sections completed');
  });
}

test('renders one editor with the canonical heading, 12 optional section fields, one copy action, six downloads, and status regions', async ({
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
  await expect(page.locator('input[type="text"]')).toHaveCount(1);
  await expect(page.locator('#backup-file')).toBeHidden();
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
  await expect(page.getByRole('button', { name: 'Copy Markdown', exact: true })).toHaveCount(1);
  const includeBlankSections = page.getByRole('checkbox', {
    name: 'Include blank sections',
    exact: true,
  });
  await expect(includeBlankSections).toHaveCount(1);
  await expect(includeBlankSections).toBeChecked();
  await expect(page.locator('.editor-downloads .editor-blank-links a[download]')).toHaveCount(3);
  await expect(page.locator('#download-heading')).toHaveText('Download your PRD');
  await expect(page.locator('.editor-downloads h3')).toHaveText('Or start with a blank file');
  await expect(page.getByRole('button', { name: 'Download draft backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import draft backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue draft', exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Continue draft', exact: true })).toBeHidden();
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
  await expect(page.getByRole('button', { name: 'Continue draft', exact: true })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Continue draft', exact: true })).toBeVisible();
});

test('Continue draft follows current non-contiguous values and its visibility never steals focus', async ({
  page,
}) => {
  const raw = JSON.stringify(createPrdEditorDraftPayload(partialDraft()));
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw },
  );
  await page.reload();
  const action = page.getByRole('button', { name: 'Continue draft', exact: true });

  await page.locator('.site-nav a').last().focus();
  await page.keyboard.press('Tab');
  await expect(action).toBeFocused();
  await sectionField(page, 2).fill('Section 3 is now complete.');
  await sectionField(page, 4).fill(' \t ');
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(sectionField(page, 4)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#section-${PRD_TEMPLATE_SECTIONS[4].id}$`));

  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await sectionField(page, index).fill(`Completed ${section.title}`);
  }
  await expect(page.locator('#completion-count')).toHaveText('12 of 12 sections completed');
  await expect(action).toBeHidden();

  await page.locator('.site-nav a').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#document-title')).toBeFocused();

  const currentFocus = sectionField(page, 7);
  await currentFocus.focus();
  await sectionField(page, 6).evaluate((input) => {
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Expected a section textarea.');
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  });
  await expect(currentFocus).toBeFocused();
  await expect(action).toBeVisible();
  await expect(page.locator('#completion-count')).toHaveText('11 of 12 sections completed');

  await action.focus();
  await page.keyboard.press('Enter');
  await expect(sectionField(page, 6)).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#section-${PRD_TEMPLATE_SECTIONS[6].id}$`));
});

test('Continue draft uses newly imported partial values', async ({ page }) => {
  const state = partialDraft();
  await page.locator('#backup-file').setInputFiles({
    name: 'partial.prd.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createPrdEditorDraftPayload(state))),
  });
  await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
  await expect(page.locator('#completion-count')).toHaveText('4 of 12 sections completed');

  const action = page.getByRole('button', { name: 'Continue draft', exact: true });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(sectionField(page, 2)).toBeFocused();
});

test('Continue draft remains navigation-only when localStorage is inaccessible', async ({
  page,
  context,
}) => {
  const raw = JSON.stringify(createPrdEditorDraftPayload(partialDraft()));
  const storagePage = await context.newPage();
  await storagePage.goto('/prd/create/');
  await storagePage.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Disabled', 'SecurityError');
      },
    });
  });
  await page.reload();
  await expect(page.locator('[data-prd-editor]')).toBeVisible();

  const before = {
    fields: await page.locator('#prd-editor-form input, #prd-editor-form textarea')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value)),
    completion: await page.locator('#completion-count').textContent(),
    status: await page.locator('#save-status').textContent(),
  };
  const action = page.getByRole('button', { name: 'Continue draft', exact: true });
  await action.focus();
  await page.keyboard.press('Enter');

  await expect(sectionField(page, 0)).toBeFocused();
  expect(await page.locator('#prd-editor-form input, #prd-editor-form textarea')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))).toEqual(before.fields);
  await expect(page.locator('#completion-count')).toHaveText(before.completion ?? '');
  await expect(page.locator('#save-status')).toHaveText(before.status ?? '');
  expect(await storedDraft(storagePage)).toBe(raw);
  await storagePage.close();
});

test('keyboard flow reaches every field and action, and outline links focus their section fields', async ({
  page,
}) => {
  const firstOutlineLink = page.locator('.editor-outline a').first();
  await firstOutlineLink.focus();
  await page.keyboard.press('Enter');
  await expect(sectionField(page, 0)).toBeFocused();

  await page.locator('#document-title').focus();
  const requiredBeforeBlankDownloads = [
    'document-title',
    ...PRD_TEMPLATE_SECTIONS.map((section) => `section-input-${section.id}`),
    'include-blank-sections',
    'copy-markdown',
    'download-md',
    'download-docx',
    'download-pdf',
  ];
  const blankDownloads = [
    'blank-download-md',
    'blank-download-docx',
    'blank-download-pdf',
  ];
  const withoutSequentialBlankDownloads = [
    ...requiredBeforeBlankDownloads,
    'save-draft',
    'start-over',
    'download-backup',
    'import-backup',
  ];
  const withSequentialBlankDownloads = [
    ...requiredBeforeBlankDownloads,
    ...blankDownloads,
    'save-draft',
    'start-over',
    'download-backup',
    'import-backup',
  ];
  const reached = ['document-title'];
  const tabLimit = withSequentialBlankDownloads.length + 2;
  for (
    let tabs = 0;
    tabs < tabLimit && reached.at(-1) !== 'import-backup';
    tabs += 1
  ) {
    await page.keyboard.press('Tab');
    reached.push(
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id ?? ''),
    );
  }
  expect(reached.at(-1), `focus did not reach import-backup within ${tabLimit} Tabs`).toBe(
    'import-backup',
  );
  expect(reached).toEqual(
    reached.length === withSequentialBlankDownloads.length
      ? withSequentialBlankDownloads
      : withoutSequentialBlankDownloads,
  );

  for (const id of ['copy-markdown', ...blankDownloads, 'download-backup', 'import-backup']) {
    const link = page.locator(`#${id}`);
    await link.focus();
    await expect(link).toBeFocused();
    const focusRing = await link.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
      };
    });
    expect(focusRing.style, `${id} focus outline style`).not.toBe('none');
    expect(focusRing.width, `${id} focus outline width`).toBeGreaterThan(0);
  }

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

test('at target widths Continue draft is at least 32px square, unobstructed, and causes no overflow', async ({
  page,
}) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 780 });
    await page.reload();

    const layout = await page.locator('#continue-draft').evaluate((button) => {
      const action = button.getBoundingClientRect();
      const text = ['#completion-count', '#save-status', '.editor-privacy'].map((selector) =>
        document.querySelector(selector)!.getBoundingClientRect()
      );
      const overlaps = (first: DOMRect, second: DOMRect) =>
        first.left < second.right && second.left < first.right &&
        first.top < second.bottom && second.top < first.bottom;
      return {
        width: action.width,
        height: action.height,
        left: action.left,
        right: action.right,
        obscuresText: text.some((rect) => overlaps(action, rect)),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      };
    });
    expect(layout.width).toBeGreaterThanOrEqual(32);
    expect(layout.height).toBeGreaterThanOrEqual(32);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(width);
    expect(layout.obscuresText).toBe(false);
    expect(layout.scrollWidth).toBe(layout.viewport);

    const targets = page.locator('.editor-outline a:visible, .editor-button:visible');
    await expect(targets).toHaveCount(21);
    const heights = await targets.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height),
    );
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(32);
  }
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
