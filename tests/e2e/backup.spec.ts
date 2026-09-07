import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_BACKUP_MAX_BYTES,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const PATH = '/prd/';
const SENTINEL = 'PORTABLE-DRAFT-LOCAL-2791-ROUNDTRIP';
const originalDate = new Date('2026-09-01T00:00:00.000Z');
const fixture = () => {
  const blank = createBlankPrdEditorState();
  const state = { ...blank, values: { ...blank.values } };
  state.title = ' \tPortable: Caf\u00e9 / \u65e5\u672c\u8a9e? \ud83c\udf31  ';
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    state.values[section.id] =
      ` \t${SENTINEL} ${index}: e\u0301 \u00e9 \ud83c\udf31\n\n  <strong data-backup-content>Plain text</strong>\n \t`;
  }
  return state;
};

const fill = async (page: Page, state: PrdEditorState) => {
  await page.locator('#document-title').fill(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await page.locator(`#section-input-${section.id}`).fill(state.values[section.id]);
  }
};

const expectFields = async (page: Page, state: PrdEditorState) => {
  await expect(page.locator('#document-title')).toHaveValue(state.title);
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await expect(page.locator(`#section-input-${section.id}`)).toHaveValue(state.values[section.id]);
  }
};

const stored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY);
const completedOutlineIds = (page: Page) =>
  page.locator('.editor-outline a[data-outline-complete]').evaluateAll((links) =>
    links.map((link) => (link as HTMLElement).dataset.outlineTarget)
  );

const choose = async (page: Page, input: string | Buffer) => {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import draft backup' }).click();
  const picker = await pending;
  await picker.setFiles(typeof input === 'string' ? input : {
    name: 'portable.prd.json', mimeType: 'application/json', buffer: input,
  });
};

const backupBytes = (state = fixture()) =>
  Buffer.from(JSON.stringify(createPrdEditorDraftPayload(state, originalDate)), 'utf8');

const download = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download draft backup' }).click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('Draft backup download has no local file.');
  const bytes = await readFile(path);
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return { file, path, payload };
};
const beforeUnloadPrevented = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

const watchRequests = (context: BrowserContext, requests: string[]) => {
  context.on('request', (request) => {
    requests.push(`${request.url()} ${request.postData() ?? ''} ${JSON.stringify(request.headers())}`);
  });
};

test.beforeEach(async ({ page }) => {
  await page.goto(PATH);
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
});

test('a real UTF-8 backup round-trips all 13 fields through a fresh browser and reload without network content', async ({
  page, context, browser,
}) => {
  const requests: string[] = [];
  watchRequests(context, requests);
  await page.evaluate(() => {
    const capture = { mime: '', created: [] as string[], revoked: [] as string[] };
    Object.assign(window, { backupUrls: capture });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      capture.mime = blob instanceof Blob ? blob.type : '';
      const url = create(blob);
      capture.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      capture.revoked.push(url);
      revoke(url);
    };
  });
  const state = fixture();
  await fill(page, state);
  const result = await download(page);
  expect(result.file.suggestedFilename()).toBe('portable-cafe-\u65e5\u672c\u8a9e.prd.json');
  expect(result.payload.version).toBe(1);
  expect(result.payload.state).toEqual(state);
  await expect.poll(() => page.evaluate(() => {
    const capture = (window as typeof window & {
      backupUrls: { mime: string; created: string[]; revoked: string[] };
    }).backupUrls;
    return { mime: capture.mime, cleaned: capture.created.length === 1 &&
      capture.created[0] === capture.revoked[0] };
  })).toEqual({ mime: 'application/json;charset=utf-8', cleaned: true });
  await expect(page.locator('a[download][href^="blob:"]')).toHaveCount(0);

  const fresh = await browser.newContext();
  watchRequests(fresh, requests);
  try {
    const other = await fresh.newPage();
    await other.goto(page.url());
    expect(await stored(other)).toBeNull();
    await choose(other, result.path);
    await expect(other.locator('#save-status')).toContainText('Draft backup imported and saved in this browser at');
    await expect(other.locator('#document-title')).toBeFocused();
    await expectFields(other, state);
    await expect(other.locator('#completion-count')).toHaveText('12 of 12 sections completed');
    expect(await completedOutlineIds(other)).toEqual(
      PRD_TEMPLATE_SECTIONS.map((section) => section.id),
    );
    await expect(other.locator('[data-backup-content]')).toHaveCount(0);
    const saved = JSON.parse((await stored(other))!);
    expect(saved.state).toEqual(state);
    expect(Date.parse(saved.savedAt)).toBeGreaterThanOrEqual(Date.parse(result.payload.savedAt));
    expect(await beforeUnloadPrevented(other)).toBe(false);
    await other.reload();
    await expectFields(other, state);
    await expect(other.locator('#save-status')).toContainText('Draft restored from this browser.');
    expect(await completedOutlineIds(other)).toEqual(
      PRD_TEMPLATE_SECTIONS.map((section) => section.id),
    );
    expect((await download(other)).payload.state).toEqual(state);
    expect(requests.join('\n')).not.toContain(SENTINEL);
  } finally {
    await fresh.close();
  }
});

test('download uses current fields before the autosave timer fires', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const state = fixture();
  await fill(page, state);
  expect(await stored(page)).toBeNull();
  expect((await download(page)).payload.state).toEqual(state);
  expect(await stored(page)).toBeNull();
});

test('invalid backups preserve every field and stored byte and can be selected again', async ({ page }) => {
  const current = fixture();
  await fill(page, current);
  await page.locator('#save-draft').click();
  const before = await stored(page);
  const payload = createPrdEditorDraftPayload(fixture(), originalDate);
  const missing = { ...payload.state.values };
  delete (missing as Partial<typeof missing>)['summary-outcome'];
  const cases = [
    { value: Buffer.from('{not json'), message: 'not valid JSON' },
    { value: Buffer.from('{}'), message: 'not a valid draft backup' },
    { value: Buffer.from(JSON.stringify({ ...payload, savedAt: 'yesterday' })), message: 'saved timestamp' },
    { value: Buffer.from(JSON.stringify({ ...payload, version: 99 })), message: 'unsupported version 99' },
    { value: Buffer.from(JSON.stringify({ ...payload, state: { ...payload.state, values: missing } })), message: 'all 12 sections as text' },
    { value: Buffer.from(JSON.stringify({ ...payload, state: { ...payload.state, title: 123 } })), message: 'text title' },
    { value: Buffer.from(JSON.stringify({ ...payload, state: { ...payload.state, values: { ...payload.state.values, 'summary-outcome': false } } })), message: 'all 12 sections as text' },
    { value: Buffer.alloc(PRD_EDITOR_BACKUP_MAX_BYTES + 1, ' '), message: '5 MiB or less' },
  ];
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss(); });
  for (const invalid of [...cases, cases[0]!]) {
    await choose(page, invalid.value);
    await expect(page.locator('#download-status')).toContainText(invalid.message);
    await expectFields(page, current);
    expect(await stored(page)).toBe(before);
    await expect(page.locator('#import-backup')).toBeEnabled();
    await expect(page.locator('#backup-file')).toHaveValue('');
  }
  expect(dialogs).toBe(0);
});

test('a file read failure leaves the draft untouched and the same file can be retried', async ({ page }) => {
  const current = fixture();
  current.title = 'Keep this saved draft';
  await fill(page, current);
  await page.locator('#save-draft').click();
  const before = await stored(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      File.prototype.text = original;
      throw new DOMException('File unavailable', 'NotReadableError');
    };
  });
  await choose(page, backupBytes());
  await expect(page.locator('#download-status')).toContainText('file could not be read');
  await expectFields(page, current);
  expect(await stored(page)).toBe(before);
  page.once('dialog', (dialog) => dialog.accept());
  await choose(page, backupBytes());
  await expectFields(page, fixture());
  await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
});

test('canceling the picker or replacement preserves the draft and allows the same backup again', async ({ page }) => {
  const current = fixture();
  current.title = 'Keep both copies';
  await fill(page, current);
  await page.locator('#save-draft').click();
  const before = await stored(page);
  const pending = page.waitForEvent('filechooser');
  await page.locator('#import-backup').click();
  await (await pending).setFiles([]);
  await expectFields(page, current);
  expect(await stored(page)).toBe(before);
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Replace the current draft');
    await dialog.dismiss();
  });
  await choose(page, backupBytes());
  await expect(page.locator('#download-status')).toHaveText('Import canceled. Your draft is unchanged.');
  await expectFields(page, current);
  expect(await stored(page)).toBe(before);
  page.once('dialog', (dialog) => dialog.accept());
  await choose(page, backupBytes());
  await expectFields(page, fixture());
  const saved = JSON.parse((await stored(page))!);
  expect(saved.state).toEqual(fixture());
  expect(Date.parse(saved.savedAt)).toBeGreaterThan(originalDate.getTime());
});

test('an invalid import does not cancel an already pending autosave', async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.locator('#document-title').fill('Pending edit stays');
  await choose(page, Buffer.from('{broken'));
  await expect(page.locator('#download-status')).toContainText('not valid JSON');
  expect(await stored(page)).toBeNull();
  await page.clock.runFor(401);
  expect(JSON.parse((await stored(page))!).state.title).toBe('Pending edit stays');
});

for (const accept of [false, true]) {
  test(`a slow read protects new edits, blocks competing imports, and ${accept ? 'clears the old autosave on acceptance' : 'keeps autosave on cancellation'}`, async ({ page }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise<void>((resolve) => Object.assign(window, { finishBackupRead: resolve }));
        return original.call(this);
      };
    });
    await choose(page, backupBytes());
    await expect(page.locator('#import-backup')).toBeDisabled();
    await expect(page.locator('#import-backup')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#backup-file')).toBeDisabled();
    await page.locator('#document-title').fill('Edit made during the file read');
    let confirmed = false;
    page.once('dialog', async (dialog) => {
      confirmed = true;
      expect(dialog.message()).toContain('Replace the current draft');
      if (accept) await dialog.accept();
      else await dialog.dismiss();
    });
    await page.evaluate(() =>
      (window as typeof window & { finishBackupRead: () => void }).finishBackupRead(),
    );
    await expect(page.locator('#import-backup')).toBeEnabled();
    expect(confirmed).toBe(true);
    if (accept) {
      await expectFields(page, fixture());
      const saved = await stored(page);
      await page.clock.runFor(1000);
      expect(await stored(page)).toBe(saved);
      await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
    } else {
      await expect(page.locator('#document-title')).toHaveValue('Edit made during the file read');
      expect(await stored(page)).toBeNull();
      await page.clock.runFor(401);
      expect(JSON.parse((await stored(page))!).state.title).toBe('Edit made during the file read');
    }
  });
}

for (const failure of ['access', 'write'] as const) {
  test(`storage ${failure} failure still permits backup download and editable import without claiming a save`, async ({ page }) => {
    const current = fixture();
    current.title = 'Current unsaved content';
    await fill(page, current);
    await page.locator('#save-draft').click();
    const before = await stored(page);
    if (failure === 'access') {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() { throw new DOMException('Disabled', 'SecurityError'); },
        });
      });
      await page.reload();
      await fill(page, current);
    } else {
      await page.evaluate(() => {
        Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError'); };
      });
    }
    const imported = failure === 'write' ? current : fixture();
    expect((await download(page)).payload.state).toEqual(current);
    page.once('dialog', (dialog) => dialog.accept());
    await choose(page, backupBytes(imported));
    await expectFields(page, imported);
    await expect(page.locator('#save-status')).toContainText('imported into the editor, but not saved in this browser');
    await expect(page.locator('#document-title')).toBeEditable();
    if (failure === 'write') expect(await stored(page)).toBe(before);
    expect((await download(page)).payload.state).toEqual(imported);
    let warned = false;
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('beforeunload');
      warned = true;
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'Example', exact: true }).click();
    expect(warned).toBe(true);
    await expect(page).toHaveURL(PATH);
    await expectFields(page, imported);
    expect((await download(page)).payload.state).toEqual(imported);
    expect(await beforeUnloadPrevented(page)).toBe(true);
    await page.locator('#document-title').fill('Continue editing');
    await expect(page.locator('#document-title')).toHaveValue('Continue editing');
  });
}

test('imported line endings survive native control normalization, other field edits, and reload', async ({ page }) => {
  const state = fixture();
  state.title = ' Title\r\nwith a newline ';
  for (const section of PRD_TEMPLATE_SECTIONS) {
    state.values[section.id] = `\r\n${state.values[section.id]}\r\n`;
  }
  await choose(page, backupBytes(state));
  await expect(page.locator('#save-status')).toContainText('Draft backup imported and saved');
  expect(JSON.parse((await stored(page))!).state).toEqual(state);
  expect((await download(page)).payload.state).toEqual(state);
  await page.locator('#section-input-summary-outcome').fill('An intentional edit');
  state.values['summary-outcome'] = 'An intentional edit';
  await page.locator('#save-draft').click();
  await page.reload();
  expect((await download(page)).payload.state).toEqual(state);
  await page.locator('#document-title').fill('New title');
  state.title = 'New title';
  expect((await download(page)).payload.state).toEqual(state);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  expect((await download(page)).payload.state).toEqual(createBlankPrdEditorState());
});

test('backup controls remain compact, local, and keyboard accessible at 320, 390, and 1280 pixels', async ({ page }) => {
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#start-over').focus();
    for (const id of ['download-backup', 'import-backup']) {
      await page.keyboard.press('Tab');
      const button = page.locator(`#${id}`);
      await expect(button).toBeFocused();
      const geometry = await button.evaluate((node) => {
        node.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          height: rect.height, width: rect.width, left: rect.left, right: rect.right,
          outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth),
        };
      });
      expect(geometry.height).toBeGreaterThanOrEqual(32);
      expect(geometry.width).toBeGreaterThanOrEqual(32);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.outline).not.toBe('none');
      expect(geometry.outlineWidth).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  }
  await expect(page.locator('#backup-help')).toContainText('reopens your editable draft');
  await expect(page.locator('#backup-help')).toContainText('stay on your device');
  await expect(page.locator('#backup-help')).toContainText('5 MiB');
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(3);
  const ids = await page.locator('[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
});
