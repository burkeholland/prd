import { expect, test, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_BACKUP_MAX_BYTES,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import {
  PRD_TEMPLATE_SECTIONS,
  serializePrdMarkdown,
} from '../../src/lib/prd-template';

const ROUTES = ['/prd/', '/prd/create/'] as const;
const FIELD_ID = `section-input-${PRD_TEMPLATE_SECTIONS.at(-1)!.id}`;

const diagnostics = new WeakMap<Page, { pageErrors: string[]; consoleErrors: string[] }>();
test.beforeEach(async ({ page }) => {
  const observed = { pageErrors: [] as string[], consoleErrors: [] as string[] };
  diagnostics.set(page, observed);
  page.on('pageerror', (error) => observed.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') observed.consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 2400 });
});
test.afterEach(async ({ page }) => {
  expect(diagnostics.get(page)).toEqual({ pageErrors: [], consoleErrors: [] });
});

type ImportKind = 'Markdown' | 'backup';
type Activation = 'pointer' | 'Enter' | 'Space';
type ImportFile = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

const currentState = () => {
  const blank = createBlankPrdEditorState();
  const values = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = index === PRD_TEMPLATE_SECTIONS.length - 1
      ? `${'Long current line '.repeat(30)}\n${Array(80).fill('Scrollable current line').join('\n')}`
      : `Current section ${index + 1}`;
  }
  return { title: 'Position-preserving current draft', values };
};

const importedState = (kind: ImportKind) => {
  const blank = createBlankPrdEditorState();
  const values = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = `Imported ${kind} section ${index + 1}`;
  }
  return { title: `Imported ${kind}`, values };
};

const importFile = (kind: ImportKind, state = importedState(kind)): ImportFile =>
  kind === 'Markdown'
    ? {
        name: 'position.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(serializePrdMarkdown(state, { includeBlankSections: false })),
      }
    : {
        name: 'position.prd.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(createPrdEditorDraftPayload(state))),
      };

const fillState = async (page: Page, state: PrdEditorState) => {
  await page.locator('#document-title').fill(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await page.locator(`#section-input-${section.id}`).fill(state.values[section.id]);
  }
};

const expectState = async (page: Page, state: PrdEditorState) => {
  await expect(page.locator('#document-title')).toHaveValue(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await expect(page.locator(`#section-input-${section.id}`)).toHaveValue(
      state.values[section.id],
    );
  }
};

const prepareAuthorPosition = async (page: Page, collapsed: boolean) => {
  const field = page.locator(`#${FIELD_ID}`);
  await page.evaluate(() => {
    document.documentElement.style.overflowX = 'auto';
    const overflow = document.createElement('div');
    overflow.style.cssText = 'position:absolute;left:0;top:0;width:calc(100vw + 200px);height:1px;pointer-events:none';
    document.body.append(overflow);
  });
  await field.evaluate((element, isCollapsed) => {
    if (!(element instanceof HTMLTextAreaElement)) throw new Error('Expected a textarea.');
    element.wrap = 'off';
    element.focus();
    element.setSelectionRange(31, isCollapsed ? 31 : 96, isCollapsed ? 'none' : 'backward');
    element.scrollTop = 180;
    element.scrollLeft = 90;
  }, collapsed);
  await page.evaluate(() => window.scrollTo(75, 450));
  return field;
};

const editorSnapshot = (page: Page) =>
  page.evaluate(({ key, fieldId }) => {
    const active = document.activeElement;
    const field = document.getElementById(fieldId);
    if (!(active instanceof HTMLTextAreaElement) || !(field instanceof HTMLTextAreaElement)) {
      throw new Error('Expected the editor textarea to be active.');
    }
    return {
      fields: Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          '#prd-editor-form input, #prd-editor-form textarea',
        ),
        (input) => input.value,
      ),
      storage: localStorage.getItem(key),
      activeId: active.id,
      selectionStart: active.selectionStart,
      selectionEnd: active.selectionEnd,
      selectionDirection: active.selectionDirection,
      fieldScrollTop: field.scrollTop,
      fieldScrollLeft: field.scrollLeft,
      windowScrollX: window.scrollX,
      windowScrollY: window.scrollY,
      progress: document.querySelector('#completion-count')?.textContent,
      outline: Array.from(
        document.querySelectorAll<HTMLAnchorElement>('[data-outline-target]'),
        (link) => ({
          id: link.dataset.outlineTarget,
          complete: link.hasAttribute('data-outline-complete'),
          statusHidden: link.querySelector('[data-outline-status]')?.hasAttribute('hidden'),
        }),
      ),
      conflictHidden: document.querySelector('#draft-conflict')?.hasAttribute('hidden'),
      saveStatus: document.querySelector('#save-status')?.textContent,
      url: location.href,
      historyLength: history.length,
    };
  }, { key: PRD_EDITOR_STORAGE_KEY, fieldId: FIELD_ID });

const activateImport = async (
  page: Page,
  kind: ImportKind,
  activation: Activation,
  file: ImportFile,
) => {
  const button = page.getByRole('button', {
    name: kind === 'Markdown' ? 'Import Markdown' : 'Import draft backup',
    exact: true,
  });
  const chooserPending = page.waitForEvent('filechooser');
  if (activation === 'pointer') {
    await button.click();
  } else {
    let reached = false;
    for (let index = 0; index < 20; index += 1) {
      await page.keyboard.press('Tab');
      if (await button.evaluate((element) => document.activeElement === element)) {
        reached = true;
        break;
      }
    }
    expect(reached).toBe(true);
    await page.keyboard.press(activation);
  }
  await (await chooserPending).setFiles(file);
};

const expectPositionRestored = async (
  page: Page,
  before: Awaited<ReturnType<typeof editorSnapshot>>,
) => {
  await expect(page.locator(`#${FIELD_ID}`)).toBeFocused();
  await expect.poll(() => editorSnapshot(page)).toEqual(before);
  await expect(page.locator('#backup-file')).toHaveValue('');
  await expect(page.locator('#markdown-file')).toHaveValue('');
  await expect(page.locator('#import-backup')).toBeEnabled();
  await expect(page.locator('#import-markdown')).toBeEnabled();
};

for (const route of ROUTES) {
  for (const kind of ['Markdown', 'backup'] as const) {
    test(`${route} ${kind} confirmation cancellation restores the complete author position`, async ({
      page,
    }) => {
      await page.goto(route);
      await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
      const importRequests: string[] = [];
      page.on('request', (request) => importRequests.push(request.url()));
      const current = currentState();
      await fillState(page, current);
      await page.locator('#save-draft').click();
      const activation: Activation = kind === 'Markdown'
        ? 'pointer'
        : route === '/prd/' ? 'Enter' : 'Space';
      const field = await prepareAuthorPosition(page, activation !== 'pointer');
      const before = await editorSnapshot(page);
      if (activation === 'pointer') {
        expect(before.selectionDirection).toBe('backward');
        expect(before.selectionEnd).toBeGreaterThan(before.selectionStart);
      } else {
        expect(before.selectionEnd).toBe(before.selectionStart);
      }
      expect(before.fieldScrollTop).toBeGreaterThan(0);
      expect(before.fieldScrollLeft).toBeGreaterThan(0);
      expect(before.windowScrollX).toBeGreaterThan(0);
      expect(before.windowScrollY).toBeGreaterThan(0);
      page.once('dialog', (dialog) => dialog.dismiss());

      await activateImport(page, kind, activation, importFile(kind));

      await expect(page.locator('#download-status')).toContainText('Import canceled');
      await expectPositionRestored(page, before);

      page.once('dialog', (dialog) => dialog.accept());
      const imported = importedState(kind);
      await activateImport(page, kind, activation, importFile(kind, imported));
      await expectState(page, imported);
      await expect(page.locator('#document-title')).toBeFocused();
      await expect(field).not.toBeFocused();
      expect(importRequests).toEqual([]);
    });
  }
}

test('native chooser cancellation restores the position for both import actions', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Additional failure paths run once in Chromium.');
  await page.goto('/prd/');
  await fillState(page, currentState());
  await page.locator('#save-draft').click();

  for (const kind of ['Markdown', 'backup'] as const) {
    await prepareAuthorPosition(page, kind === 'backup');
    const before = await editorSnapshot(page);
    const button = page.getByRole('button', {
      name: kind === 'Markdown' ? 'Import Markdown' : 'Import draft backup',
      exact: true,
    });
    const chooserPending = page.waitForEvent('filechooser');
    if (kind === 'Markdown') {
      await button.click();
    } else {
      let reached = false;
      for (let index = 0; index < 20; index += 1) {
        await page.keyboard.press('Tab');
        if (await button.evaluate((element) => document.activeElement === element)) {
          reached = true;
          break;
        }
      }
      expect(reached).toBe(true);
      await page.keyboard.press('Enter');
    }
    await (await chooserPending).setFiles([]);
    await expectPositionRestored(page, before);
  }
});

test('invalid and unreadable Markdown restores position after every retryable failure', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Additional failure paths run once in Chromium.');
  await page.goto('/prd/');
  await fillState(page, currentState());
  await page.locator('#save-draft').click();
  const failures: Array<{ file: ImportFile; message: string; failRead?: boolean }> = [
    {
      file: { name: 'invalid.md', mimeType: 'text/markdown', buffer: Buffer.from('not canonical') },
      message: 'document title',
    },
    {
      file: { name: 'invalid.md', mimeType: 'text/markdown', buffer: Buffer.from([0xff, 0xfe]) },
      message: 'not valid UTF-8',
    },
    {
      file: {
        name: 'oversize.md',
        mimeType: 'text/markdown',
        buffer: Buffer.alloc(PRD_EDITOR_BACKUP_MAX_BYTES + 1),
      },
      message: '5 MiB or less',
    },
    {
      file: { name: 'unsupported.png', mimeType: 'image/png', buffer: Buffer.from('# Ignored') },
      message: 'Choose a Markdown',
    },
    {
      file: importFile('Markdown'),
      message: 'could not be read',
      failRead: true,
    },
  ];

  for (const failure of failures) {
    await prepareAuthorPosition(page, false);
    const before = await editorSnapshot(page);
    if (failure.failRead) {
      await page.evaluate(() => {
        const arrayBuffer = File.prototype.arrayBuffer;
        File.prototype.arrayBuffer = async function () {
          File.prototype.arrayBuffer = arrayBuffer;
          throw new DOMException('Unavailable', 'NotReadableError');
        };
      });
    }
    await activateImport(page, 'Markdown', 'pointer', failure.file);
    await expect(page.locator('#download-status')).toContainText(failure.message);
    await expectPositionRestored(page, before);
  }
});

for (const timing of ['before selection', 'during confirmation'] as const) {
  test(`a stale saved copy ${timing} restores the author position`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'Additional failure paths run once in Chromium.');
    await page.goto('/prd/');
    await fillState(page, currentState());
    await page.locator('#save-draft').click();
    await prepareAuthorPosition(page, false);
    const before = await editorSnapshot(page);
    const blank = createBlankPrdEditorState();
    const changed = { ...blank, values: { ...blank.values } };
    changed.title = `Saved ${timing}`;
    const raw = JSON.stringify(createPrdEditorDraftPayload(changed));
    if (timing === 'before selection') {
      await page.evaluate(
        ({ key, value }) => localStorage.setItem(key, value),
        { key: PRD_EDITOR_STORAGE_KEY, value: raw },
      );
    } else {
      await page.evaluate(({ key, value }) => {
        window.confirm = () => {
          localStorage.setItem(key, value);
          return true;
        };
      }, { key: PRD_EDITOR_STORAGE_KEY, value: raw });
    }

    await activateImport(page, 'Markdown', 'pointer', importFile('Markdown'));

    await expect(page.locator('#download-status')).toContainText('Import paused');
    await expect(page.locator(`#${FIELD_ID}`)).toBeFocused();
    await expect.poll(() => editorSnapshot(page).then((snapshot) => ({
      activeId: snapshot.activeId,
      selectionStart: snapshot.selectionStart,
      selectionEnd: snapshot.selectionEnd,
      selectionDirection: snapshot.selectionDirection,
      fieldScrollTop: snapshot.fieldScrollTop,
      fieldScrollLeft: snapshot.fieldScrollLeft,
      windowScrollX: snapshot.windowScrollX,
      windowScrollY: snapshot.windowScrollY,
    }))).toEqual({
      activeId: before.activeId,
      selectionStart: before.selectionStart,
      selectionEnd: before.selectionEnd,
      selectionDirection: before.selectionDirection,
      fieldScrollTop: before.fieldScrollTop,
      fieldScrollLeft: before.fieldScrollLeft,
      windowScrollX: before.windowScrollX,
      windowScrollY: before.windowScrollY,
    });
  });
}
