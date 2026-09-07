import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import {
  PRD_TEMPLATE_SECTIONS,
  serializePrdMarkdown,
  serializePrdSectionMarkdown,
} from '../../src/lib/prd-template';

const ROUTES = ['/prd/', '/prd/create/'] as const;
const SENTINEL = 'PRIVATE-SECTION-COPY-SENTINEL-3000';

type ClipboardMode = 'success' | 'hold' | 'reject' | 'absent';

const installClipboard = (page: Page, mode: ClipboardMode = 'success') =>
  page.addInitScript((clipboardMode) => {
    const state = {
      mode: clipboardMode,
      attempts: [] as string[],
      writes: [] as string[],
      release: undefined as (() => void) | undefined,
    };
    Object.assign(window, { __sectionCopyClipboard: state });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboardMode === 'absent'
        ? undefined
        : {
            writeText(text: string) {
              state.attempts.push(text);
              if (state.mode === 'reject') {
                return Promise.reject(
                  new DOMException('Clipboard denied', 'NotAllowedError'),
                );
              }
              if (state.mode === 'hold') {
                return new Promise<void>((resolve) => {
                  state.release = () => {
                    state.writes.push(text);
                    resolve();
                  };
                });
              }
              state.writes.push(text);
              return Promise.resolve();
            },
          },
    });
  }, mode);

const setClipboardMode = (page: Page, mode: Exclude<ClipboardMode, 'absent'>) =>
  page.evaluate((nextMode) => {
    const state = (window as typeof window & {
      __sectionCopyClipboard: { mode: ClipboardMode };
    }).__sectionCopyClipboard;
    state.mode = nextMode;
  }, mode);

const clipboardState = (page: Page) =>
  page.evaluate(() => {
    const state = (window as typeof window & {
      __sectionCopyClipboard: {
        attempts: string[];
        writes: string[];
      };
    }).__sectionCopyClipboard;
    return {
      attempts: [...state.attempts],
      writes: [...state.writes],
    };
  });

const releaseClipboard = (page: Page) =>
  page.evaluate(() => {
    const state = (window as typeof window & {
      __sectionCopyClipboard: { release?: () => void };
    }).__sectionCopyClipboard;
    state.release?.();
  });

const sectionAction = (page: Page, index: number) =>
  page.getByRole('button', {
    name: `Copy ${PRD_TEMPLATE_SECTIONS[index].title} section as Markdown`,
    exact: true,
  });

const sectionField = (page: Page, index: number) =>
  page.locator(`#section-input-${PRD_TEMPLATE_SECTIONS[index].id}`);

const stateWith = (label: string): PrdEditorState => ({
  title: `${label} title`,
  values: Object.fromEntries(PRD_TEMPLATE_SECTIONS.map((section, index) => [
    section.id,
    `${label} ${index + 1}\n\n- ${section.id}`,
  ])) as PrdEditorState['values'],
});

const fillState = async (page: Page, state: PrdEditorState) => {
  await page.locator('#document-title').fill(state.title);
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    await sectionField(page, index).fill(state.values[section.id]);
  }
};

const observeCopyMessages = (page: Page) =>
  page.evaluate(() => {
    const status = document.querySelector('#section-copy-status');
    const messages: string[] = [];
    Object.assign(window, { __sectionCopyMessages: messages });
    new MutationObserver(() => {
      const message = status?.textContent ?? '';
      if (message) messages.push(message);
    }).observe(status!, { childList: true, characterData: true, subtree: true });
  });

const resetCopyMessages = (page: Page) =>
  page.evaluate(() => {
    (window as typeof window & { __sectionCopyMessages: string[] })
      .__sectionCopyMessages.length = 0;
  });

const copyMessages = (page: Page) =>
  page.evaluate(() =>
    [...(window as typeof window & { __sectionCopyMessages: string[] })
      .__sectionCopyMessages]
  );

const settleRestorationFrames = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

const editorSnapshot = (page: Page) =>
  page.evaluate((key) => ({
    fields: Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '#prd-editor-form input, #prd-editor-form textarea',
      ),
      (input) => ({
        id: input.id,
        value: input.value,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
        selectionDirection: input.selectionDirection,
        scrollTop: input.scrollTop,
        scrollLeft: input.scrollLeft,
      }),
    ),
    scroll: { x: window.scrollX, y: window.scrollY },
    activeId: (document.activeElement as HTMLElement | null)?.id,
    stored: localStorage.getItem(key),
    conflict: {
      hidden: (document.querySelector('#draft-conflict') as HTMLElement).hidden,
      text: document.querySelector('#draft-conflict')?.textContent,
      saveDisabled: document.querySelector('#save-draft')?.getAttribute('aria-disabled'),
      startOverDisabled: document.querySelector('#start-over')?.getAttribute('aria-disabled'),
    },
    completion: document.querySelector('#completion-count')?.textContent,
    outline: Array.from(
      document.querySelectorAll<HTMLElement>('[data-outline-target]'),
      (link) => ({
        id: link.dataset.outlineTarget,
        complete: link.hasAttribute('data-outline-complete'),
        statusHidden: link.querySelector('[data-outline-status]')?.hasAttribute('hidden'),
      }),
    ),
    url: location.href,
    historyLength: history.length,
    saveStatus: document.querySelector('#save-status')?.textContent,
    downloadStatus: document.querySelector('#download-status')?.textContent,
  }), PRD_EDITOR_STORAGE_KEY);

const prepareRejectedPointerState = async (page: Page, index: number) => {
  const action = sectionAction(page, index);
  const field = sectionField(page, index);
  await page.evaluate(() => {
    document.documentElement.style.overflowX = 'auto';
    const overflow = document.createElement('div');
    overflow.style.cssText =
      'position:absolute;left:0;top:0;width:calc(100vw + 200px);height:1px;pointer-events:none';
    document.body.append(overflow);
  });
  await field.evaluate((input) => {
    if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing textarea.');
    input.wrap = 'off';
    input.focus({ preventScroll: true });
    input.setSelectionRange(31, 96, 'backward');
    input.scrollTop = 180;
    input.scrollLeft = 90;
  });
  await action.evaluate((button) => {
    const top = button.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(75, Math.max(1, top - 40));
  });
};

const copySection = async (
  page: Page,
  index: number,
  expectedValue: string,
) => {
  const section = PRD_TEMPLATE_SECTIONS[index];
  await sectionAction(page, index).click();
  await expect(page.locator('#section-copy-status')).toHaveText(
    `Copied ${section.title} section as Markdown.`,
  );
  expect((await clipboardState(page)).writes.at(-1)).toBe(
    serializePrdSectionMarkdown(section.id, expectedValue),
  );
};

const downloadBytes = async (page: Page, selector: string) => {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const path = await (await pending).path();
  if (!path) throw new Error(`No temporary path for ${selector}.`);
  return readFile(path);
};

const downloadAll = async (page: Page, selectors: readonly string[]) => {
  const downloads: Buffer[] = [];
  for (const selector of selectors) {
    downloads.push(await downloadBytes(page, selector));
  }
  return downloads;
};

test('both routes expose exactly 12 labeled actions and copy every canonical fragment', async ({
  page,
}) => {
  await installClipboard(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('.editor-section-copy')).toHaveCount(12);
    await expect(page.locator('.editor-title-field .editor-section-copy')).toHaveCount(0);
    await expect(page.locator('#section-copy-status')).toHaveCount(1);

    for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
      const action = sectionAction(page, index);
      const field = sectionField(page, index);
      await expect(action).toHaveCount(1);
      await expect(action).toHaveText('Copy section');
      await expect(action).toHaveAccessibleName(
        `Copy ${section.title} section as Markdown`,
      );
      await expect(page.locator(`label[for="${await field.getAttribute('id')}"]`))
        .toContainText(section.title);

      const value = ` \n${route} decision ${index + 1}\r\n\nSupporting line. \n`;
      await field.fill(value);
      await copySection(page, index, value);
    }

    await sectionField(page, 0).fill('');
    await copySection(page, 0, '');
    await sectionField(page, 1).fill(' \t\n ');
    await copySection(page, 1, ' \t\n ');
  }

  expect(errors).toEqual([]);
});

test('click, Enter, and Space each make one write and one section-specific announcement', async ({
  page,
}) => {
  await installClipboard(page);
  await page.goto(ROUTES[0]);
  await page.evaluate(() => {
    const status = document.querySelector('#section-copy-status');
    if (!status) throw new Error('Missing section copy status.');
  });
  await observeCopyMessages(page);

  const section = PRD_TEMPLATE_SECTIONS[2];
  const action = sectionAction(page, 2);
  for (const [index, activation] of ['click', 'Enter', 'Space'].entries()) {
    const value = `Activation ${activation} ${index}`;
    await sectionField(page, 2).fill(value);
    await page.evaluate(() => {
      (window as typeof window & { __sectionCopyMessages: string[] })
        .__sectionCopyMessages.length = 0;
    });

    if (activation === 'click') {
      await action.click();
    } else {
      await action.focus();
      await page.keyboard.press(activation);
    }

    await expect(page.locator('#section-copy-status')).toHaveText(
      `Copied ${section.title} section as Markdown.`,
    );
    const state = await clipboardState(page);
    expect(state.attempts).toHaveLength(index + 1);
    expect(state.writes).toHaveLength(index + 1);
    expect(state.writes.at(-1)).toBe(
      serializePrdSectionMarkdown(section.id, value),
    );
    expect(await copyMessages(page)).toEqual([
      `Copied ${section.title} section as Markdown.`,
    ]);
    await expect(action).toHaveAccessibleName(
      `Copy ${section.title} section as Markdown`,
    );
  }
});

test('one pending section write blocks duplicate activations across all actions', async ({
  page,
}) => {
  await installClipboard(page, 'hold');
  await page.goto(ROUTES[0]);
  await sectionField(page, 0).fill('Held write');

  await sectionAction(page, 0).click();
  await expect(sectionAction(page, 0)).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.editor-section-copy[aria-disabled="true"]')).toHaveCount(12);
  expect((await clipboardState(page)).attempts).toHaveLength(1);

  await page.evaluate(() => {
    const first = document.querySelector<HTMLButtonElement>('#copy-section-summary-outcome');
    const second = document.querySelector<HTMLButtonElement>('#copy-section-context-problem');
    first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect((await clipboardState(page)).attempts).toHaveLength(1);

  await releaseClipboard(page);
  await expect(page.locator('#section-copy-status')).toHaveText(
    `Copied ${PRD_TEMPLATE_SECTIONS[0].title} section as Markdown.`,
  );
  expect((await clipboardState(page)).writes).toEqual([
    serializePrdSectionMarkdown(PRD_TEMPLATE_SECTIONS[0].id, 'Held write'),
  ]);
  await expect(page.locator('.editor-section-copy[aria-disabled]')).toHaveCount(0);
});

test('pointer rejection restores complete state, focuses the action, and permits an immediate retry on both routes', async ({
  page,
}) => {
  await installClipboard(page, 'reject');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const index = PRD_TEMPLATE_SECTIONS.length - 1;
  const section = PRD_TEMPLATE_SECTIONS[index];
  for (const route of ROUTES) {
    await page.goto(route);
    await observeCopyMessages(page);
    const rejected = stateWith(`Rejected ${route}`);
    const draft: PrdEditorState = {
      ...rejected,
      values: {
        ...rejected.values,
        [section.id]:
          `${'Wide rejected field '.repeat(40)}\n${'Scrollable field line\n'.repeat(80)}${SENTINEL}`,
      },
    };
    await fillState(page, draft);
    await page.locator('#save-draft').click();

    const external = stateWith(`External conflict ${route}`);
    await page.evaluate(({ key, raw }) => {
      localStorage.setItem(key, raw);
      window.dispatchEvent(new StorageEvent('storage', {
        key,
        newValue: raw,
        storageArea: localStorage,
      }));
    }, {
      key: PRD_EDITOR_STORAGE_KEY,
      raw: JSON.stringify(createPrdEditorDraftPayload(external)),
    });
    await expect(page.locator('#draft-conflict')).toBeVisible();

    const field = sectionField(page, index);
    const action = sectionAction(page, index);
    await prepareRejectedPointerState(page, index);
    const before = await editorSnapshot(page);
    const fieldId = await field.getAttribute('id');
    const selectedField = before.fields.find(({ id }) => id === fieldId);
    expect(before.activeId).toBe(fieldId);
    expect(selectedField?.selectionDirection).toBe('backward');
    expect(selectedField?.selectionEnd).toBeGreaterThan(selectedField?.selectionStart ?? 0);
    expect(selectedField?.scrollTop).toBeGreaterThan(0);
    expect(selectedField?.scrollLeft).toBeGreaterThan(0);
    expect(before.scroll.x).toBeGreaterThan(0);
    expect(before.scroll.y).toBeGreaterThan(0);
    await resetCopyMessages(page);

    await action.click();
    const failure =
      `Could not copy ${section.title} section as Markdown. Your draft is unchanged.`;
    await expect(page.locator('#section-copy-status')).toHaveText(failure);
    await settleRestorationFrames(page);

    expect(await editorSnapshot(page)).toEqual({
      ...before,
      activeId: `copy-section-${section.id}`,
    });
    expect(await clipboardState(page)).toEqual({
      attempts: [serializePrdSectionMarkdown(section.id, draft.values[section.id])],
      writes: [],
    });
    expect(await copyMessages(page)).toEqual([failure]);
    await expect(action).toBeFocused();
    await expect(action).not.toHaveAttribute('aria-busy');
    await expect(page.locator('.editor-section-copy[aria-disabled]')).toHaveCount(0);

    await field.evaluate((input) => {
      if (!(input instanceof HTMLTextAreaElement)) throw new Error('Missing textarea.');
      input.setSelectionRange(109, 147, 'forward');
      input.scrollTop = 240;
      input.scrollLeft = 130;
    });
    await action.evaluate((button) => {
      const top = button.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(110, Math.max(1, top - 65));
    });
    const beforeRetry = await editorSnapshot(page);
    expect(beforeRetry).not.toEqual(before);
    expect(beforeRetry.activeId).toBe(`copy-section-${section.id}`);
    await setClipboardMode(page, 'success');
    await resetCopyMessages(page);

    await page.keyboard.press('Enter');
    const success = `Copied ${section.title} section as Markdown.`;
    await expect(page.locator('#section-copy-status')).toHaveText(success);
    await settleRestorationFrames(page);

    expect(await editorSnapshot(page)).toEqual(beforeRetry);
    expect(await clipboardState(page)).toEqual({
      attempts: [
        serializePrdSectionMarkdown(section.id, draft.values[section.id]),
        serializePrdSectionMarkdown(section.id, draft.values[section.id]),
      ],
      writes: [serializePrdSectionMarkdown(section.id, draft.values[section.id])],
    });
    expect(await copyMessages(page)).toEqual([success]);
    await expect(action).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('Enter and Space rejection each keep focus and announce one failed attempt', async ({
  page,
}) => {
  await installClipboard(page, 'reject');
  await page.goto(ROUTES[0]);
  await observeCopyMessages(page);
  const index = 2;
  const section = PRD_TEMPLATE_SECTIONS[index];
  const action = sectionAction(page, index);

  for (const activation of ['Enter', 'Space'] as const) {
    const value = `Rejected ${activation}`;
    await sectionField(page, index).fill(value);
    await action.focus();
    await page.evaluate(() => {
      const clipboard = (window as typeof window & {
        __sectionCopyClipboard: { attempts: string[]; writes: string[] };
      }).__sectionCopyClipboard;
      clipboard.attempts.length = 0;
      clipboard.writes.length = 0;
    });
    await resetCopyMessages(page);

    await page.keyboard.press(activation);
    const failure =
      `Could not copy ${section.title} section as Markdown. Your draft is unchanged.`;
    await expect(page.locator('#section-copy-status')).toHaveText(failure);
    await settleRestorationFrames(page);

    expect(await clipboardState(page)).toEqual({
      attempts: [serializePrdSectionMarkdown(section.id, value)],
      writes: [],
    });
    expect(await copyMessages(page)).toEqual([failure]);
    await expect(action).toBeFocused();
    await expect(action).not.toHaveAttribute('aria-busy');
    await expect(page.locator('.editor-section-copy[aria-disabled]')).toHaveCount(0);
  }
});

test('section copy is local and byte-neutral for every export and full Copy Markdown', async ({
  page,
}) => {
  await installClipboard(page);
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (item, value) {
      if (this === localStorage && item === key) writes += 1;
      return original.call(this, item, value);
    };
    Object.defineProperty(window, '__sectionStorageWrites', {
      get: () => writes,
    });
  }, PRD_EDITOR_STORAGE_KEY);
  await page.goto(ROUTES[0]);
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2026-09-07T17:30:00.000Z'));
  const draft = stateWith(SENTINEL);
  await fillState(page, draft);
  await page.locator('#save-draft').click();
  const selectors = ['#download-md', '#download-docx', '#download-pdf', '#download-backup'];
  const beforeBytes = await downloadAll(page, selectors);
  const before = await page.evaluate((key) => ({
    fields: Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '#prd-editor-form input, #prd-editor-form textarea',
      ),
      (field) => field.value,
    ),
    stored: localStorage.getItem(key),
    storageWrites: (window as typeof window & { __sectionStorageWrites: number })
      .__sectionStorageWrites,
    url: location.href,
    historyLength: history.length,
  }), PRD_EDITOR_STORAGE_KEY);
  const requests: string[] = [];
  const errors: string[] = [];
  let track = true;
  page.on('request', (request) => {
    if (track) requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await copySection(page, 7, draft.values['data-apis-integrations']);
  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  await expect(page.locator('#download-status')).toHaveText(
    'Copied Markdown to the clipboard.',
  );
  track = false;

  const afterBytes = await downloadAll(page, selectors);
  const after = await page.evaluate((key) => ({
    fields: Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '#prd-editor-form input, #prd-editor-form textarea',
      ),
      (field) => field.value,
    ),
    stored: localStorage.getItem(key),
    storageWrites: (window as typeof window & { __sectionStorageWrites: number })
      .__sectionStorageWrites,
    url: location.href,
    historyLength: history.length,
  }), PRD_EDITOR_STORAGE_KEY);

  expect(after).toEqual(before);
  expect(afterBytes).toEqual(beforeBytes);
  expect((await clipboardState(page)).writes).toEqual([
    serializePrdSectionMarkdown(
      PRD_TEMPLATE_SECTIONS[7].id,
      draft.values['data-apis-integrations'],
    ),
    serializePrdMarkdown(draft),
  ]);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(page.url()).not.toContain(SENTINEL);
  expect(await page.locator('html').evaluate(
    (html, sentinel) => html.outerHTML.includes(sentinel),
    SENTINEL,
  )).toBe(false);
});

test('copy always reads the current field after all six replacement paths', async ({
  page,
}) => {
  await installClipboard(page);
  await page.goto(ROUTES[0]);
  const index = 1;
  const section = PRD_TEMPLATE_SECTIONS[index];

  const restored = stateWith('Saved restore');
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: PRD_EDITOR_STORAGE_KEY,
    raw: JSON.stringify(createPrdEditorDraftPayload(restored)),
  });
  await page.reload();
  await copySection(page, index, restored.values[section.id]);

  const backup = stateWith('JSON import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#backup-file').setInputFiles({
    name: 'replacement.prd.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createPrdEditorDraftPayload(backup))),
  });
  await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
  await copySection(page, index, backup.values[section.id]);

  const markdown = stateWith('Markdown import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#markdown-file').setInputFiles({
    name: 'replacement.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(serializePrdMarkdown(markdown)),
  });
  await expect(page.locator('#save-status')).toContainText('Markdown imported and saved');
  await copySection(page, index, markdown.values[section.id]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  await expect(sectionField(page, index)).toHaveValue('');
  await copySection(page, index, '');

  const localBeforeLoad = stateWith('Local before load');
  await fillState(page, localBeforeLoad);
  await page.locator('#save-draft').click();
  const loaded = stateWith('Load saved draft');
  await page.evaluate(({ key, raw }) => {
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: raw,
      storageArea: localStorage,
    }));
  }, {
    key: PRD_EDITOR_STORAGE_KEY,
    raw: JSON.stringify(createPrdEditorDraftPayload(loaded)),
  });
  await expect(page.locator('#draft-conflict')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-saved-draft').click();
  await expect(sectionField(page, index)).toHaveValue(loaded.values[section.id]);
  await copySection(page, index, loaded.values[section.id]);

  const keptValue = 'Keep this live field exactly';
  await sectionField(page, index).fill(keptValue);
  const newer = stateWith('Newer external draft');
  await page.evaluate(({ key, raw }) => {
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent('storage', {
      key,
      newValue: raw,
      storageArea: localStorage,
    }));
  }, {
    key: PRD_EDITOR_STORAGE_KEY,
    raw: JSON.stringify(createPrdEditorDraftPayload(newer)),
  });
  await expect(page.locator('#draft-conflict')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#keep-this-draft').click();
  await expect(sectionField(page, index)).toHaveValue(keptValue);
  await copySection(page, index, keptValue);
});

test('clipboard and JavaScript fallbacks add no section-copy UI', async ({
  browser,
  page,
}) => {
  await installClipboard(page, 'absent');
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('.editor-section-copy, #section-copy-status')).toHaveCount(0);
    await expect(page.locator('.editor-section-download')).toHaveCount(12);
    await expect(page.locator('#prd-editor-form input, #prd-editor-form textarea')).toHaveCount(13);
    await expect(page.locator('.editor-download-actions .editor-button')).toHaveCount(4);
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noScriptPage = await context.newPage();
    for (const route of ROUTES) {
      await noScriptPage.goto(route);
      await expect(
        noScriptPage.locator('.editor-section-action, #section-copy-status'),
      ).toHaveCount(0);
      await expect(
        noScriptPage.locator('#prd-editor-form input, #prd-editor-form textarea'),
      ).toHaveCount(13);
      await expect(noScriptPage.locator('noscript .editor-blank-links a')).toHaveCount(3);
    }
  } finally {
    await context.close();
  }
});

test('section actions are print-hidden, 32px targets, non-overlapping, and overflow-free', async ({
  page,
}) => {
  await installClipboard(page);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(ROUTES[0]);
    const geometry = await page.locator('.editor-section').evaluateAll((sections) =>
      sections.map((section) => {
        const action = section.querySelector('.editor-section-copy')!.getBoundingClientRect();
        const label = section.querySelector('label')!.getBoundingClientRect();
        const prompt = section.querySelector('.editor-prompt')!.getBoundingClientRect();
        const field = section.querySelector('textarea')!.getBoundingClientRect();
        const overlaps = (first: DOMRect, second: DOMRect) =>
          first.left < second.right && second.left < first.right &&
          first.top < second.bottom && second.top < first.bottom;
        return {
          width: action.width,
          height: action.height,
          left: action.left,
          right: action.right,
          clipped: section.querySelector('.editor-section-copy')!.scrollWidth >
            section.querySelector('.editor-section-copy')!.clientWidth,
          overlapsLabel: overlaps(action, label),
          overlapsPrompt: overlaps(action, prompt),
          overlapsField: overlaps(action, field),
        };
      })
    );
    for (const [index, action] of geometry.entries()) {
      expect(action.width, `${width}px action ${index + 1} width`).toBeGreaterThanOrEqual(32);
      expect(action.height, `${width}px action ${index + 1} height`).toBeGreaterThanOrEqual(32);
      expect(action.left, `${width}px action ${index + 1} left`).toBeGreaterThanOrEqual(0);
      expect(action.right, `${width}px action ${index + 1} right`).toBeLessThanOrEqual(width);
      expect(action.clipped, `${width}px action ${index + 1} clipped`).toBe(false);
      expect(action.overlapsLabel, `${width}px action ${index + 1} label overlap`).toBe(false);
      expect(action.overlapsPrompt, `${width}px action ${index + 1} prompt overlap`).toBe(false);
      expect(action.overlapsField, `${width}px action ${index + 1} field overlap`).toBe(false);
    }
    expect(await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }))).toEqual({ scrollWidth: width, viewport: width });
  }

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.editor-section-actions:visible, #section-copy-status:visible'))
    .toHaveCount(0);
  await expect(page.locator('.prd-print')).toBeVisible();
  await expect(page.locator('.prd-print h2')).toHaveCount(12);
});
