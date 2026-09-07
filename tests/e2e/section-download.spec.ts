import { readFile } from 'node:fs/promises';
import {
  expect,
  test,
  type Browser,
  type Download,
  type Page,
} from '@playwright/test';
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
const SENTINEL = 'PRIVATE-SECTION-DOWNLOAD-SENTINEL-3066';

type Activation = 'click' | 'Enter' | 'Space';
type ClipboardMode = 'success' | 'hold' | 'reject' | 'absent';

const sectionDownload = (page: Page, index: number) =>
  page.getByRole('button', {
    name: `Download ${PRD_TEMPLATE_SECTIONS[index].title} section as Markdown`,
    exact: true,
  });

const sectionCopy = (page: Page, index: number) =>
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

const bytesFrom = async (download: Download) => {
  const path = await download.path();
  if (!path) throw new Error(`No temporary path for ${download.suggestedFilename()}.`);
  return readFile(path);
};

const activateDownload = async (
  page: Page,
  index: number,
  activation: Activation = 'click',
) => {
  const action = sectionDownload(page, index);
  const pending = page.waitForEvent('download');
  if (activation === 'click') {
    await action.click();
  } else {
    await action.focus();
    await page.keyboard.press(activation);
  }
  const download = await pending;
  return { download, bytes: await bytesFrom(download) };
};

const expectSectionDownload = async (
  page: Page,
  index: number,
  value: string,
  activation: Activation = 'click',
) => {
  const section = PRD_TEMPLATE_SECTIONS[index];
  const result = await activateDownload(page, index, activation);
  expect(result.download.suggestedFilename()).toBe(`prd-section-${section.id}.md`);
  expect(result.bytes).toEqual(
    Buffer.from(serializePrdSectionMarkdown(section.id, value), 'utf8'),
  );
  return result;
};

const installObjectUrlCapture = (page: Page) =>
  page.addInitScript(() => {
    const capture = {
      created: [] as Array<{ url: string; type: string; text?: string }>,
      revoked: [] as string[],
    };
    Object.assign(window, { __sectionDownloadUrls: capture });
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      const url = createObjectURL(object);
      const entry = {
        url,
        type: object instanceof Blob ? object.type : '',
        text: undefined as string | undefined,
      };
      capture.created.push(entry);
      if (object instanceof Blob) {
        void object.text().then((text) => {
          entry.text = text;
        });
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      capture.revoked.push(url);
      revokeObjectURL(url);
    };
  });

const latestObjectUrl = (page: Page) =>
  page.evaluate(() => {
    const capture = (window as typeof window & {
      __sectionDownloadUrls: {
        created: Array<{ url: string; type: string; text?: string }>;
        revoked: string[];
      };
    }).__sectionDownloadUrls;
    return {
      created: capture.created.at(-1),
      revoked: [...capture.revoked],
    };
  });

const installClipboard = (page: Page, mode: ClipboardMode) =>
  page.addInitScript((clipboardMode) => {
    const state = {
      mode: clipboardMode,
      attempts: [] as string[],
      writes: [] as string[],
      release: undefined as (() => void) | undefined,
    };
    Object.assign(window, { __sectionDownloadClipboard: state });
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

const clipboardState = (page: Page) =>
  page.evaluate(() => {
    const state = (window as typeof window & {
      __sectionDownloadClipboard: {
        attempts: string[];
        writes: string[];
      };
    }).__sectionDownloadClipboard;
    return {
      attempts: [...state.attempts],
      writes: [...state.writes],
    };
  });

const releaseClipboard = (page: Page) =>
  page.evaluate(() => {
    const state = (window as typeof window & {
      __sectionDownloadClipboard: { release?: () => void };
    }).__sectionDownloadClipboard;
    state.release?.();
  });

const createClipboardPage = async (browser: Browser, mode: ClipboardMode) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installClipboard(page, mode);
  return { context, page };
};

test('both routes download all 12 canonical sections with exact bytes, MIME, and fixed names', async ({
  page,
}) => {
  await installObjectUrlCapture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('.editor-section-download')).toHaveCount(12);
    await expect(page.locator('.editor-title-field .editor-section-download')).toHaveCount(0);

    for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
      const action = sectionDownload(page, index);
      const value = ` \r\n${route} decision ${index + 1} — café\rSupporting ${SENTINEL}. \n `;
      await expect(action).toHaveCount(1);
      await expect(action).toHaveText('Download section (.md)');
      await expect(action).toHaveAccessibleName(
        `Download ${section.title} section as Markdown`,
      );
      expect(await action.evaluate((button) => (button as HTMLElement).tabIndex))
        .toBeGreaterThanOrEqual(0);

      await sectionField(page, index).fill(value);
      await expectSectionDownload(page, index, value);
      await expect.poll(async () => (await latestObjectUrl(page)).created?.text)
        .toBe(serializePrdSectionMarkdown(section.id, value));
      const capture = await latestObjectUrl(page);
      expect(capture.created?.type).toBe('text/markdown;charset=utf-8');
      await expect.poll(async () =>
        (await latestObjectUrl(page)).revoked.includes(capture.created!.url)
      ).toBe(true);
      await expect(page.locator('a[href^="blob:"]')).toHaveCount(0);
    }
  }

  await sectionField(page, 0).fill('');
  await expectSectionDownload(page, 0, '');
  await sectionField(page, 1).fill(' \t\r\n ');
  await expectSectionDownload(page, 1, ' \t\r\n ');
  expect(errors).toEqual([]);
});

test('pointer, Enter, Space, and retry each start one download without touching Clipboard or status', async ({
  page,
}) => {
  await installClipboard(page, 'success');
  await page.goto(ROUTES[0]);
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  const index = 2;
  const section = PRD_TEMPLATE_SECTIONS[index];
  const copyStatus = page.locator('#section-copy-status');
  const downloadStatus = page.locator('#download-status');
  const initialStatuses = {
    copy: await copyStatus.evaluate((status) => ({
      text: status.textContent,
      state: (status as HTMLElement).dataset.state,
    })),
    download: await downloadStatus.evaluate((status) => ({
      text: status.textContent,
      state: (status as HTMLElement).dataset.state,
    })),
  };

  for (const [activationIndex, activation] of [
    'click',
    'Enter',
    'Space',
    'click',
  ].entries()) {
    const method = activation as Activation;
    const value = activationIndex === 3
      ? 'Activation Space 2'
      : `Activation ${activation} ${activationIndex}`;
    await sectionField(page, index).fill(value);
    await expectSectionDownload(page, index, value, method);
    expect(downloads).toHaveLength(activationIndex + 1);
    await expect(sectionDownload(page, index)).toHaveText('Download section (.md)');
    await expect(sectionDownload(page, index)).toHaveAccessibleName(
      `Download ${section.title} section as Markdown`,
    );
    expect(await clipboardState(page)).toEqual({ attempts: [], writes: [] });
    expect({
      copy: await copyStatus.evaluate((status) => ({
        text: status.textContent,
        state: (status as HTMLElement).dataset.state,
      })),
      download: await downloadStatus.evaluate((status) => ({
        text: status.textContent,
        state: (status as HTMLElement).dataset.state,
      })),
    }).toEqual(initialStatuses);
  }
});

test('downloads always read the live field after typing and all six replacement paths', async ({
  page,
}) => {
  await page.goto(ROUTES[0]);
  const index = 1;
  const section = PRD_TEMPLATE_SECTIONS[index];

  const typed = 'Freshly typed value';
  await sectionField(page, index).fill(typed);
  await expectSectionDownload(page, index, typed);

  const restored = stateWith('Saved restore');
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
    key: PRD_EDITOR_STORAGE_KEY,
    raw: JSON.stringify(createPrdEditorDraftPayload(restored)),
  });
  await page.reload();
  await expectSectionDownload(page, index, restored.values[section.id]);

  const backup = stateWith('JSON import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#backup-file').setInputFiles({
    name: 'replacement.prd.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(createPrdEditorDraftPayload(backup))),
  });
  await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
  await expectSectionDownload(page, index, backup.values[section.id]);

  const markdown = stateWith('Markdown import');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#markdown-file').setInputFiles({
    name: 'replacement.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(serializePrdMarkdown(markdown)),
  });
  await expect(page.locator('#save-status')).toContainText('Markdown imported and saved');
  await expectSectionDownload(page, index, markdown.values[section.id]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  await expect(sectionField(page, index)).toHaveValue('');
  await expectSectionDownload(page, index, '');

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
  await expectSectionDownload(page, index, loaded.values[section.id]);

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
  await expectSectionDownload(page, index, keptValue);
});

test('downloads remain independent when Clipboard is absent, denied, or held', async ({
  browser,
}) => {
  const absent = await createClipboardPage(browser, 'absent');
  try {
    for (const route of ROUTES) {
      await absent.page.goto(route);
      await expect(absent.page.locator('.editor-section-download')).toHaveCount(12);
      await expect(
        absent.page.locator('.editor-section-copy, #section-copy-status'),
      ).toHaveCount(0);
      await sectionField(absent.page, 0).fill('Clipboard absent');
      await expectSectionDownload(absent.page, 0, 'Clipboard absent');
    }
  } finally {
    await absent.context.close();
  }

  const rejected = await createClipboardPage(browser, 'reject');
  try {
    await rejected.page.goto(ROUTES[0]);
    const beforeDownloads = await rejected.page.locator('.editor-section-download')
      .evaluateAll((buttons) => buttons.map((button) => ({
        text: button.textContent,
        ariaLabel: button.getAttribute('aria-label'),
        disabled: (button as HTMLButtonElement).disabled,
        ariaDisabled: button.getAttribute('aria-disabled'),
        ariaBusy: button.getAttribute('aria-busy'),
      })));
    await sectionCopy(rejected.page, 0).click();
    await expect(rejected.page.locator('#section-copy-status')).toContainText(
      'Could not copy',
    );
    const rejectedStatus = await rejected.page.locator('#section-copy-status').evaluate(
      (status) => ({ text: status.textContent, state: (status as HTMLElement).dataset.state }),
    );
    expect(
      await rejected.page.locator('.editor-section-download').evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent,
          ariaLabel: button.getAttribute('aria-label'),
          disabled: (button as HTMLButtonElement).disabled,
          ariaDisabled: button.getAttribute('aria-disabled'),
          ariaBusy: button.getAttribute('aria-busy'),
        }))
      ),
    ).toEqual(beforeDownloads);
    await sectionField(rejected.page, 0).fill('Clipboard rejected');
    await expectSectionDownload(rejected.page, 0, 'Clipboard rejected');
    expect(await rejected.page.locator('#section-copy-status').evaluate(
      (status) => ({ text: status.textContent, state: (status as HTMLElement).dataset.state }),
    )).toEqual(rejectedStatus);
    expect(await clipboardState(rejected.page)).toEqual({
      attempts: [serializePrdSectionMarkdown(PRD_TEMPLATE_SECTIONS[0].id, '')],
      writes: [],
    });
  } finally {
    await rejected.context.close();
  }

  const held = await createClipboardPage(browser, 'hold');
  try {
    await held.page.goto(ROUTES[0]);
    await sectionField(held.page, 0).fill('Clipboard held');
    await sectionCopy(held.page, 0).click();
    await expect(sectionCopy(held.page, 0)).toHaveAttribute('aria-busy', 'true');
    await expect(held.page.locator('.editor-section-download[aria-disabled]')).toHaveCount(0);
    await expect(held.page.locator('.editor-section-download:disabled')).toHaveCount(0);
    const pendingCopy = await held.page.locator('#section-copy-status').evaluate(
      (status) => ({ text: status.textContent, state: (status as HTMLElement).dataset.state }),
    );
    await expectSectionDownload(held.page, 0, 'Clipboard held');
    expect(await held.page.locator('#section-copy-status').evaluate(
      (status) => ({ text: status.textContent, state: (status as HTMLElement).dataset.state }),
    )).toEqual(pendingCopy);
    expect(await clipboardState(held.page)).toEqual({
      attempts: [
        serializePrdSectionMarkdown(PRD_TEMPLATE_SECTIONS[0].id, 'Clipboard held'),
      ],
      writes: [],
    });
    await releaseClipboard(held.page);
    await expect(sectionCopy(held.page, 0)).not.toHaveAttribute('aria-busy');
  } finally {
    await held.context.close();
  }
});

const downloadBytes = async (page: Page, selector: string) => {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  return bytesFrom(await pending);
};

const downloadFullDraft = async (page: Page) => {
  const bytes: Buffer[] = [];
  for (const selector of [
    '#download-md',
    '#download-docx',
    '#download-pdf',
    '#download-backup',
  ]) {
    bytes.push(await downloadBytes(page, selector));
  }
  return bytes;
};

const editorSnapshot = (page: Page) =>
  page.evaluate((storageKey) => ({
    fields: Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '#prd-editor-form input, #prd-editor-form textarea',
      ),
      (field) => ({
        id: field.id,
        value: field.value,
        selectionStart: field.selectionStart,
        selectionEnd: field.selectionEnd,
        selectionDirection: field.selectionDirection,
        scrollTop: field.scrollTop,
        scrollLeft: field.scrollLeft,
      }),
    ),
    fieldScroll: {
      x: window.scrollX,
      y: window.scrollY,
    },
    stored: localStorage.getItem(storageKey),
    storageMutations: (window as typeof window & { __sectionStorageMutations: number })
      .__sectionStorageMutations,
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
    historyState: history.state,
    theme: document.documentElement.getAttribute('data-theme'),
    textSize: document.documentElement.getAttribute('data-text-size'),
    statuses: {
      save: document.querySelector('#save-status')?.textContent,
      download: document.querySelector('#download-status')?.textContent,
      copy: document.querySelector('#section-copy-status')?.textContent,
      copyState: (document.querySelector('#section-copy-status') as HTMLElement | null)
        ?.dataset.state,
    },
    copyActions: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.editor-section-copy'),
      (button) => ({
        text: button.textContent,
        disabled: button.disabled,
        ariaDisabled: button.getAttribute('aria-disabled'),
        ariaBusy: button.getAttribute('aria-busy'),
      }),
    ),
  }), PRD_EDITOR_STORAGE_KEY);

test('a section download is local and neutral to editor, copy, export, and saved state', async ({
  page,
}) => {
  await installClipboard(page, 'success');
  await page.addInitScript(() => {
    let mutations = 0;
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    const clear = Storage.prototype.clear;
    Storage.prototype.setItem = function (...args) {
      mutations += 1;
      return setItem.apply(this, args);
    };
    Storage.prototype.removeItem = function (...args) {
      mutations += 1;
      return removeItem.apply(this, args);
    };
    Storage.prototype.clear = function (...args) {
      mutations += 1;
      return clear.apply(this, args);
    };
    Object.defineProperty(window, '__sectionStorageMutations', {
      get: () => mutations,
    });
  });
  await page.goto(ROUTES[0]);
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2026-09-07T19:30:00.000Z'));
  const baseDraft = stateWith(SENTINEL);
  const draft: PrdEditorState = {
    ...baseDraft,
    values: {
      ...baseDraft.values,
      'data-apis-integrations':
        `${'Wide private field '.repeat(40)}\n${'Private line\n'.repeat(80)}${SENTINEL}`,
    },
  };
  await fillState(page, draft);
  await page.locator('#save-draft').click();
  const beforeBytes = await downloadFullDraft(page);

  const index = 7;
  const field = sectionField(page, index);
  const action = sectionDownload(page, index);
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
    window.scrollTo(0, Math.max(1, top - 40));
  });
  const before = await editorSnapshot(page);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await expectSectionDownload(
    page,
    index,
    draft.values['data-apis-integrations'],
  );
  const after = await editorSnapshot(page);
  expect(after).toEqual(before);
  expect(await clipboardState(page)).toEqual({ attempts: [], writes: [] });
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  expect(page.url()).not.toContain(SENTINEL);
  expect(await page.locator('html').evaluate(
    (html, sentinel) => html.outerHTML.includes(sentinel),
    SENTINEL,
  )).toBe(false);
  await expect(page.locator('a[href^="blob:"]')).toHaveCount(0);

  page.removeAllListeners('request');
  const afterBytes = await downloadFullDraft(page);
  expect(afterBytes).toEqual(beforeBytes);
});

test('section actions fit every target viewport, text size, theme, and editor route', async ({
  page,
}) => {
  for (const route of ROUTES) {
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(route);

      for (const theme of ['light', 'dark']) {
        for (const textSize of ['default', 'large']) {
          await page.evaluate(({ nextTheme, nextTextSize }) => {
            document.documentElement.dataset.theme = nextTheme;
            if (nextTextSize === 'large') {
              document.documentElement.dataset.textSize = 'large';
            } else {
              delete document.documentElement.dataset.textSize;
            }
          }, { nextTheme: theme, nextTextSize: textSize });

          const geometry = await page.locator('.editor-section').evaluateAll((sections) =>
            sections.map((section) => {
              const actions = Array.from(
                section.querySelectorAll<HTMLElement>('.editor-section-action'),
              );
              const label = section.querySelector('label')!.getBoundingClientRect();
              const prompt = section.querySelector('.editor-prompt')!.getBoundingClientRect();
              const field = section.querySelector('textarea')!.getBoundingClientRect();
              const overlaps = (first: DOMRect, second: DOMRect) =>
                first.left < second.right && second.left < first.right &&
                first.top < second.bottom && second.top < first.bottom;
              return actions.map((action, actionIndex) => {
                const bounds = action.getBoundingClientRect();
                return {
                  className: action.className,
                  width: bounds.width,
                  height: bounds.height,
                  left: bounds.left,
                  right: bounds.right,
                  clipped: action.scrollWidth > action.clientWidth ||
                    action.scrollHeight > action.clientHeight,
                  overlapsLabel: overlaps(bounds, label),
                  overlapsPrompt: overlaps(bounds, prompt),
                  overlapsField: overlaps(bounds, field),
                  overlapsAction: actions.some((other, otherIndex) =>
                    otherIndex !== actionIndex &&
                    overlaps(bounds, other.getBoundingClientRect())
                  ),
                };
              });
            })
          );
          expect(geometry).toHaveLength(12);
          for (const [sectionIndex, actions] of geometry.entries()) {
            expect(actions, `${route} ${width}px section ${sectionIndex + 1}`).toHaveLength(2);
            for (const action of actions) {
              const context =
                `${route} ${width}px ${theme}/${textSize} ${action.className}`;
              expect(action.width, `${context} width`).toBeGreaterThanOrEqual(32);
              expect(action.height, `${context} height`).toBeGreaterThanOrEqual(32);
              expect(action.left, `${context} left`).toBeGreaterThanOrEqual(0);
              expect(action.right, `${context} right`).toBeLessThanOrEqual(width);
              expect(action.clipped, `${context} clipped`).toBe(false);
              expect(action.overlapsLabel, `${context} label overlap`).toBe(false);
              expect(action.overlapsPrompt, `${context} prompt overlap`).toBe(false);
              expect(action.overlapsField, `${context} field overlap`).toBe(false);
              expect(action.overlapsAction, `${context} action overlap`).toBe(false);
            }
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth))
            .toBeLessThanOrEqual(width);
        }
      }
    }
  }
});

test('no JavaScript adds no dead section controls and print hides enhanced actions', async ({
  browser,
  page,
}) => {
  for (const route of ROUTES) {
    await page.goto(route);
    await expect(page.locator('.editor-section-download')).toHaveCount(12);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.editor-section-actions:visible')).toHaveCount(0);
    await expect(page.locator('.prd-print')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  }

  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const noScriptPage = await context.newPage();
    for (const route of ROUTES) {
      await noScriptPage.goto(route);
      await expect(noScriptPage.locator('.editor-section-action')).toHaveCount(0);
      await expect(noScriptPage.locator('noscript .editor-blank-links a')).toHaveCount(3);
    }
  } finally {
    await context.close();
  }
});
