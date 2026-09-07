import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
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

const PATH = '/prd/';
const SENTINEL = 'MARKDOWN-IMPORT-PRIVATE-2958';

const fixture = (indexes: readonly number[], title = 'Imported requirements') => {
  const blank = createBlankPrdEditorState();
  const values = { ...blank.values };
  for (const index of indexes) {
    const section = PRD_TEMPLATE_SECTIONS[index]!;
    values[section.id] = `${SENTINEL} section ${index + 1}.\n\n- Decision ${index + 1}`;
  }
  return { title, values };
};

const fields = (page: Page) =>
  page.locator('#prd-editor-form input, #prd-editor-form textarea')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLInputElement | HTMLTextAreaElement).value)
    );

const expectedFields = (state: PrdEditorState) => [
  state.title,
  ...PRD_TEMPLATE_SECTIONS.map(({ id }) => state.values[id]),
];

const stored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY);

const completedOutlineIds = (page: Page) =>
  page.locator('.editor-outline a[data-outline-complete]').evaluateAll((links) =>
    links.map((link) => (link as HTMLElement).dataset.outlineTarget)
  );

const writeFixture = async (
  testInfo: TestInfo,
  name: string,
  contents: string | Buffer,
) => {
  const path = testInfo.outputPath(name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return path;
};

const chooseMarkdown = async (page: Page, path: string) => {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import Markdown', exact: true }).click();
  await (await pending).setFiles(path);
  await expect(page.locator('#markdown-file')).toHaveValue('');
};

const fillState = async (page: Page, state: PrdEditorState) => {
  await page.locator('#document-title').fill(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await page.locator(`#section-input-${section.id}`).fill(state.values[section.id]);
  }
};

const beforeUnloadPrevented = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test.beforeEach(async ({ page }) => {
  await page.goto(PATH);
  await page.evaluate((key) => localStorage.removeItem(key), PRD_EDITOR_STORAGE_KEY);
  await page.reload();
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
});

for (const { label, indexes } of [
  { label: 'all 12 sections', indexes: PRD_TEMPLATE_SECTIONS.map((_, index) => index) },
  { label: 'three mixed sections', indexes: [1, 5, 10] },
  { label: 'a title only', indexes: [] },
]) {
  test(`own-output Markdown with ${label} imports exactly 13 fields`, async ({
    page,
  }, testInfo) => {
    const state = fixture(indexes);
    const markdown = serializePrdMarkdown(state, { includeBlankSections: false });
    const path = await writeFixture(testInfo, `${label.replaceAll(' ', '-')}.md`, markdown);

    await chooseMarkdown(page, path);

    expect(await fields(page)).toEqual(expectedFields(state));
    await expect(page.locator('#save-status')).toContainText(
      'Markdown imported and saved in this browser at',
    );
    await expect(page.locator('#document-title')).toBeFocused();
    const saved = JSON.parse((await stored(page))!);
    expect(saved).toMatchObject({ version: 1, state });
    const completed = indexes.map((index) => PRD_TEMPLATE_SECTIONS[index]!.id);
    await expect(page.locator('#completion-count')).toHaveText(
      `${completed.length} of 12 sections completed`,
    );
    expect(await completedOutlineIds(page)).toEqual(completed);
    await expect(page.locator('#markdown-file')).toHaveValue('');
  });
}

test('supported body syntax, progress, Continue draft, print, and exports reflect imported fields', async ({
  page,
}, testInfo) => {
  const body = [
    'First paragraph.',
    '',
    '- list item',
    '- [ ] task one',
    '- [x] task two',
    '',
    '```ts',
    '## Context and problem',
    'const privateValue = "keep Markdown";',
    '```',
    '',
    '> A quoted decision.',
    '',
    '[Supporting link](https://example.com/details)',
    '',
    '### Implementation detail',
    '',
    '#### Deeper detail',
    '',
    'Final paragraph.',
  ].join('\n');
  const first = PRD_TEMPLATE_SECTIONS[0]!;
  const sixth = PRD_TEMPLATE_SECTIONS[5]!;
  const state = fixture([]);
  state.title = 'Syntax fixture';
  state.values[first.id] = body;
  state.values[sixth.id] = 'Second imported section.';
  const markdown = serializePrdMarkdown(state, { includeBlankSections: false });
  const path = await writeFixture(testInfo, 'syntax.md', markdown.replaceAll('\n', '\r\n'));

  await chooseMarkdown(page, path);

  expect(await fields(page)).toEqual(expectedFields(state));
  await expect(page.locator('#completion-count')).toHaveText('2 of 12 sections completed');
  expect(await completedOutlineIds(page)).toEqual([first.id, sixth.id]);
  await page.getByRole('button', { name: 'Continue draft', exact: true }).click();
  await expect(page.locator(`#section-input-${PRD_TEMPLATE_SECTIONS[1]!.id}`)).toBeFocused();

  await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click();
  await expect(page.locator('#download-status')).toHaveText(
    'Copied Markdown to the clipboard.',
  );
  expect(
    (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'),
  ).toBe(serializePrdMarkdown(state));

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('[data-prd-print-title]')).toHaveText(state.title);
  expect(await page.locator('[data-prd-print-value]').allTextContents()).toEqual(
    PRD_TEMPLATE_SECTIONS.map(({ id }) => state.values[id]),
  );
});

test('the invalid matrix reports one reason and changes no field or storage byte', async ({
  page,
}, testInfo) => {
  const current = fixture(PRD_TEMPLATE_SECTIONS.map((_, index) => index), 'Keep this draft');
  await fillState(page, current);
  await page.locator('#save-draft').click();
  const beforeFields = await fields(page);
  const beforeStorage = await stored(page);
  const first = PRD_TEMPLATE_SECTIONS[0]!;
  const second = PRD_TEMPLATE_SECTIONS[1]!;
  const cases: Array<{
    name: string;
    contents: string | Buffer;
    message: RegExp;
  }> = [
    {
      name: 'duplicate.md',
      contents: `# Title\n\n## ${first.title}\n\nOne\n\n## ${first.title}\n\nTwo\n`,
      message: /duplicate .* section heading/i,
    },
    {
      name: 'out-of-order.md',
      contents: `# Title\n\n## ${second.title}\n\nTwo\n\n## ${first.title}\n\nOne\n`,
      message: /out of order/i,
    },
    {
      name: 'unknown.md',
      contents: '# Title\n\n## Delivery schedule\n\nUnknown\n',
      message: /not one of the 12 section headings/i,
    },
    {
      name: 'missing-h1.md',
      contents: `## ${first.title}\n\nBody\n`,
      message: /Add one "# " document title/i,
    },
    {
      name: 'multiple-h1.md',
      contents: '# Title\n\n# Another title\n',
      message: /exactly one "# " document title/i,
    },
    {
      name: 'preamble.md',
      contents: 'Preamble\n\n# Title\n',
      message: /Remove nonblank text before/i,
    },
    {
      name: 'no-sections.md',
      contents: '# Title\n\nArbitrary noncanonical Markdown.\n',
      message: /No canonical section heading was found/i,
    },
    {
      name: 'invalid-utf8.md',
      contents: Buffer.from([0x23, 0x20, 0xc3, 0x28]),
      message: /not valid UTF-8/i,
    },
    {
      name: 'oversize.md',
      contents: Buffer.alloc(PRD_EDITOR_BACKUP_MAX_BYTES + 1, 0x20),
      message: /5 MiB or less/i,
    },
  ];
  let dialogs = 0;
  page.on('dialog', async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    Object.assign(window, { markdownArrayBufferReads: 0 });
    File.prototype.arrayBuffer = function () {
      if (this.size > 5 * 1024 * 1024) {
        (window as typeof window & { markdownArrayBufferReads: number })
          .markdownArrayBufferReads += 1;
      }
      return original.call(this);
    };
  });

  for (const invalid of cases) {
    const path = await writeFixture(testInfo, invalid.name, invalid.contents);
    await chooseMarkdown(page, path);
    await expect(page.locator('#download-status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#download-status')).toHaveText(invalid.message);
    expect(await fields(page)).toEqual(beforeFields);
    expect(await stored(page)).toBe(beforeStorage);
    await expect(page.locator('#markdown-file')).toHaveValue('');
    await expect(page.locator('#import-markdown')).toBeEnabled();
  }
  expect(dialogs).toBe(0);
  expect(await page.evaluate(
    () => (window as typeof window & { markdownArrayBufferReads: number })
      .markdownArrayBufferReads,
  )).toBe(0);
});

test('canceling one replacement prompt preserves the complete editor state and permits the same file', async ({
  page,
}, testInfo) => {
  const current = fixture([0, 3, 7], 'Current draft');
  current.values[PRD_TEMPLATE_SECTIONS[0]!.id] = Array(30).fill('Current line').join('\n');
  await fillState(page, current);
  await page.locator('#save-draft').click();
  const imported = fixture([2, 4], 'Replacement');
  const path = await writeFixture(
    testInfo,
    'replacement.md',
    serializePrdMarkdown(imported, { includeBlankSections: false }),
  );
  const focused = page.locator(`#section-input-${PRD_TEMPLATE_SECTIONS[0]!.id}`);
  await focused.focus();
  await focused.evaluate((input) => {
    if (!(input instanceof HTMLTextAreaElement)) {
      throw new Error('Expected the first section textarea.');
    }
    input.scrollTop = input.scrollHeight;
    input.setSelectionRange(5, 5);
  });
  await page.evaluate(() => window.scrollTo(0, 500));
  const before = await page.evaluate((key) => {
    const active = document.activeElement as HTMLTextAreaElement;
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
      fieldScroll: active.scrollTop,
      pageScroll: window.scrollY,
      progress: document.querySelector('#completion-count')?.textContent,
      outline: Array.from(
        document.querySelectorAll('[data-outline-complete]'),
        (link) => (link as HTMLElement).dataset.outlineTarget,
      ),
      conflictHidden: document.querySelector('#draft-conflict')?.hasAttribute('hidden'),
    };
  }, PRD_EDITOR_STORAGE_KEY);
  let prompts = 0;
  page.once('dialog', async (dialog) => {
    prompts += 1;
    expect(dialog.message()).toContain('Replace all 13 current fields');
    await dialog.dismiss();
  });

  await page.locator('#markdown-file').setInputFiles(path);
  await expect(page.locator('#markdown-file')).toHaveValue('');

  const after = await page.evaluate((key) => {
    const active = document.activeElement as HTMLTextAreaElement;
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
      fieldScroll: active.scrollTop,
      pageScroll: window.scrollY,
      progress: document.querySelector('#completion-count')?.textContent,
      outline: Array.from(
        document.querySelectorAll('[data-outline-complete]'),
        (link) => (link as HTMLElement).dataset.outlineTarget,
      ),
      conflictHidden: document.querySelector('#draft-conflict')?.hasAttribute('hidden'),
    };
  }, PRD_EDITOR_STORAGE_KEY);
  expect(after).toEqual(before);
  expect(prompts).toBe(1);
  await expect(page.locator('#markdown-file')).toHaveValue('');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#markdown-file').setInputFiles(path);
  await expect(page.locator('#markdown-file')).toHaveValue('');
  expect(await fields(page)).toEqual(expectedFields(imported));
  await expect(page.locator('#save-status')).toContainText('Markdown imported and saved');
});

test('storage changes before selection and during confirmation never overwrite either copy', async ({
  page,
}, testInfo) => {
  const current = fixture([0], 'Current local fields');
  await fillState(page, current);
  await page.locator('#save-draft').click();
  const imported = fixture([1], 'Do not import');
  const importPath = await writeFixture(
    testInfo,
    'conflicted.md',
    serializePrdMarkdown(imported, { includeBlankSections: false }),
  );
  const external = JSON.stringify(createPrdEditorDraftPayload(
    fixture([2], 'Newer stored copy'),
  ));
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw: external },
  );
  await chooseMarkdown(page, importPath);

  expect(await fields(page)).toEqual(expectedFields(current));
  expect(await stored(page)).toBe(external);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  await expect(page.locator('#download-status')).toContainText('Import paused');

  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await fillState(page, current);
  await page.locator('#save-draft').click();
  const baseline = await stored(page);
  expect(baseline).not.toBe(external);
  const changedDuringConfirmation = JSON.stringify(createPrdEditorDraftPayload(
    fixture([3], 'Changed during confirmation'),
  ));
  await page.evaluate(({ key, raw }) => {
    Object.assign(window, { markdownConfirmCalls: 0 });
    window.confirm = () => {
      (window as typeof window & { markdownConfirmCalls: number })
        .markdownConfirmCalls += 1;
      localStorage.setItem(key, raw);
      return true;
    };
  }, { key: PRD_EDITOR_STORAGE_KEY, raw: changedDuringConfirmation });

  await page.locator('#markdown-file').setInputFiles(importPath);
  await expect(page.locator('#markdown-file')).toHaveValue('');

  expect(await page.evaluate(
    () => (window as typeof window & { markdownConfirmCalls: number })
      .markdownConfirmCalls,
  )).toBe(1);
  expect(await fields(page)).toEqual(expectedFields(current));
  expect(await stored(page)).toBe(changedDuringConfirmation);
  await expect(page.locator('#draft-conflict')).toBeVisible();
  await expect(page.locator('#download-status')).toContainText(
    'changed during confirmation',
  );
});

test('storage denial leaves imported fields editable, unsaved, and protected on leave', async ({
  page,
}, testInfo) => {
  const imported = fixture([0, 8, 11], 'Unsaved imported Markdown');
  const path = await writeFixture(
    testInfo,
    'unsaved.md',
    serializePrdMarkdown(imported, { includeBlankSections: false }),
  );
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (this === localStorage && storageKey === key) {
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return set.call(this, storageKey, value);
    };
  }, PRD_EDITOR_STORAGE_KEY);

  await chooseMarkdown(page, path);

  expect(await fields(page)).toEqual(expectedFields(imported));
  expect(await stored(page)).toBeNull();
  await expect(page.locator('#save-status')).toContainText(
    'Markdown imported into the editor, but not saved in this browser',
  );
  await expect(page.locator('#document-title')).toBeEditable();
  expect(await beforeUnloadPrevented(page)).toBe(true);
});

test('a read error resets the picker so the same real file succeeds on retry', async ({
  page,
}, testInfo) => {
  const imported = fixture([4], 'Retry import');
  const path = await writeFixture(
    testInfo,
    'retry.md',
    serializePrdMarkdown(imported, { includeBlankSections: false }),
  );
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      File.prototype.arrayBuffer = original;
      throw new DOMException('Unavailable', 'NotReadableError');
    };
  });

  await chooseMarkdown(page, path);

  await expect(page.locator('#download-status')).toContainText(
    'file could not be read',
  );
  expect(await fields(page)).toEqual(Array(13).fill(''));
  await expect(page.locator('#markdown-file')).toHaveValue('');

  await chooseMarkdown(page, path);
  expect(await fields(page)).toEqual(expectedFields(imported));
});

test('import is local-only, semantically distinct, keyboard-visible, and overflow-free', async ({
  page,
  context,
}, testInfo) => {
  const imported = fixture([0], `${SENTINEL} local document`);
  const path = await writeFixture(
    testInfo,
    'private.md',
    serializePrdMarkdown(imported, { includeBlankSections: false }),
  );
  const requests: string[] = [];
  const logs: string[] = [];
  watchRequests(context, requests);
  page.on('console', (message) => logs.push(message.text()));

  await chooseMarkdown(page, path);

  expect(requests).toEqual([]);
  expect(page.url()).not.toContain(SENTINEL);
  expect(logs.join('\n')).not.toContain(SENTINEL);
  await expect(page.locator('#markdown-import-help')).toContainText(
    'converts a finished document',
  );
  await expect(page.locator('#markdown-import-help')).toContainText(
    'Use JSON when you need an exact backup',
  );
  await expect(page.locator('#backup-help')).toContainText(
    'all 13 fields preserved exactly',
  );
  await expect(page.locator('#markdown-file')).toHaveAttribute(
    'accept',
    '.md,text/markdown,text/plain',
  );

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const button = page.locator('#import-markdown');
    await page.locator('#import-backup').focus();
    await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    const geometry = await button.evaluate((node) => {
      node.scrollIntoView({ behavior: 'instant', block: 'center' });
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        width: box.width,
        height: box.height,
        left: box.left,
        right: box.right,
        outline: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(geometry.width).toBeGreaterThanOrEqual(32);
    expect(geometry.height).toBeGreaterThanOrEqual(32);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.outline).not.toBe('none');
    expect(geometry.outlineWidth).toBeGreaterThan(0);
    expect(geometry.scrollWidth).toBe(geometry.clientWidth);
  }
});

function watchRequests(context: BrowserContext, requests: string[]) {
  context.on('request', (request) => {
    requests.push(`${request.url()} ${request.postData() ?? ''}`);
  });
}
