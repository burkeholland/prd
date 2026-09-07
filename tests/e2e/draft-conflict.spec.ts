import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';

const fixture = (title: string): PrdEditorState => {
  const blank = createBlankPrdEditorState();
  const state = { title, values: { ...blank.values } };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    state.values[section.id] = ` \t${index}: Caf\u00e9 e\u0301 \ud83c\udf31\r\n\r\n  <b>Plain text</b>\r \t`;
  }
  return state;
};
const rawDraft = (state: PrdEditorState) =>
  JSON.stringify(createPrdEditorDraftPayload(state, new Date('2026-09-01T00:00:00.000Z')));
const stored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), PRD_EDITOR_STORAGE_KEY);
const put = (page: Page, raw: string | null) =>
  page.evaluate(({ key, raw }) => {
    if (raw === null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  }, { key: PRD_EDITOR_STORAGE_KEY, raw });
const fields = (page: Page) => page.locator('#prd-editor-form input, #prd-editor-form textarea')
  .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
const backup = async (page: Page) => {
  const pending = page.waitForEvent('download');
  await page.locator('#download-backup').click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing backup file');
  return JSON.parse(await readFile(path, 'utf8'));
};
const openPair = async (page: Page, context: BrowserContext, path = '/prd/') => {
  await page.goto(path);
  await expect(page.locator('[data-prd-editor]')).toBeVisible();
  await put(page, rawDraft(fixture('Original saved draft')));
  await page.reload();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'restored');
  const other = await context.newPage();
  await other.goto(path === '/prd/' ? '/prd/create/' : '/prd/');
  await expect(other.locator('#save-status')).toHaveAttribute('data-state', 'restored');
  for (const tab of [page, other]) {
    await tab.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
  }
  return other;
};
const expectConflict = (page: Page) =>
  expect(page.locator('#save-status')).toHaveAttribute('data-state', 'conflict');
const chooseBackup = (page: Page, state: PrdEditorState) =>
  page.locator('#backup-file').setInputFiles({
    name: 'local.prd.json', mimeType: 'application/json', buffer: Buffer.from(rawDraft(state)),
  });
const missStorageEvents = (page: Page) => page.addInitScript(() => {
  window.addEventListener('storage', (event) => event.stopImmediatePropagation(), true);
});

for (const path of ['/prd/', '/prd/create/']) {
  for (const flush of ['debounce', 'pagehide']) {
    test(`${path} stale ${flush} preserves the newer saved draft and all 13 local strings`, async ({ page, context }) => {
      const other = await openPair(page, context, path);
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      await page.locator('#document-title').fill('Older local edits');
      const before = await fields(page);
      await other.locator('#document-title').fill('Newer saved draft');
      await other.locator('#save-draft').click();
      const newer = await stored(other);
      expect(JSON.parse(newer!).state.title).toBe('Newer saved draft');
      if (flush === 'debounce') await page.clock.runFor(401);
      else await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      expect(await stored(page)).toBe(newer);
      expect(await fields(page)).toEqual(before);
      await expect(page.locator('#save-status')).toContainText('Saving is paused');
      await expect(page.locator('#draft-conflict button')).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Load saved draft', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Keep this draft', exact: true })).toBeVisible();
      expect((await backup(page)).state).toEqual(fixture('Older local edits'));
    });
  }
}

test('known conflict blocks Save, Start over and import without dialogs or live announcements on typing', async ({ page, context }) => {
  const other = await openPair(page, context);
  await put(other, rawDraft(fixture('Newer saved copy')));
  await expectConflict(page);
  const newer = await stored(page);
  await page.evaluate(() => {
    const counts = { statusChanges: 0 };
    Object.assign(window, { conflictCounts: counts });
    const observer = new MutationObserver(() => { counts.statusChanges += 1; });
    for (const id of ['save-status', 'completion-count']) {
      observer.observe(document.getElementById(id)!, { childList: true, characterData: true, subtree: true });
    }
  });
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss(); });
  await page.locator('#document-title').fill('Continue editing locally');
  await page.locator('#section-input-summary-outcome').fill('Still editable');
  await expect(page.locator('#section-input-summary-outcome')).toBeFocused();
  expect(await page.evaluate(() =>
    (window as typeof window & { conflictCounts: { statusChanges: number } }).conflictCounts.statusChanges,
  )).toBe(0);
  await page.locator('#section-input-summary-outcome').fill('');
  await expect(page.locator('#completion-count')).toHaveText('11 of 12 sections completed');
  await page.locator('#section-input-summary-outcome').fill('Still editable');
  await expect(page.locator('#completion-count')).toHaveText('12 of 12 sections completed');
  const before = await fields(page);
  for (const id of ['save-draft', 'start-over']) {
    await expect(page.locator(`#${id}`)).toHaveAttribute('aria-disabled', 'true');
    await page.locator(`#${id}`).focus();
    await page.keyboard.press('Enter');
  }
  await chooseBackup(page, fixture('Do not import'));
  await expect(page.locator('#download-status')).toContainText('Import paused');
  expect(await fields(page)).toEqual(before);
  expect(await stored(page)).toBe(newer);
  expect(dialogs).toBe(0);
  await expectConflict(page);
});

test('Continue draft preserves an active conflict and follows the newly loaded saved values', async ({
  page,
  context,
}) => {
  const other = await openPair(page, context);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const localDestination = PRD_TEMPLATE_SECTIONS[2];
  const savedDestination = PRD_TEMPLATE_SECTIONS[4];
  await page.locator(`#section-input-${localDestination.id}`).fill('');
  await other.locator(`#section-input-${savedDestination.id}`).fill(' \t ');
  await other.locator('#save-draft').click();
  await expectConflict(page);

  const action = page.getByRole('button', { name: 'Continue draft', exact: true });
  const before = {
    fields: await fields(page),
    raw: await stored(page),
    status: await page.locator('#save-status').textContent(),
    completion: await page.locator('#completion-count').textContent(),
  };
  await action.focus();
  await page.keyboard.press('Enter');

  await expect(page.locator(`#section-input-${localDestination.id}`)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Load saved draft', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep this draft', exact: true })).toBeVisible();
  await expect(page.locator('#save-draft')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#start-over')).toHaveAttribute('aria-disabled', 'true');
  expect(await fields(page)).toEqual(before.fields);
  expect(await stored(page)).toBe(before.raw);
  await expect(page.locator('#save-status')).toHaveText(before.status ?? '');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'conflict');
  await expect(page.locator('#completion-count')).toHaveText(before.completion ?? '');

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-saved-draft').click();
  await expect(page.locator('#draft-conflict')).toBeHidden();
  await expect(page.locator('#completion-count')).toHaveText('11 of 12 sections completed');
  expect(await stored(page)).toBe(before.raw);

  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`#section-input-${savedDestination.id}`)).toBeFocused();
});

for (const action of ['load-saved-draft', 'keep-this-draft']) {
  test(`${action} cancels safely, re-reads the latest copy, resolves losslessly and resumes autosave`, async ({ page, context }) => {
    const other = await openPair(page, context);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await expect(page.getByRole('button', { name: 'Load saved draft', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keep this draft', exact: true })).toHaveCount(0);
    await put(other, rawDraft(fixture('First external update')));
    await expectConflict(page);
    await page.locator('#document-title').fill('Unsaved local copy');
    const before = await fields(page);
    const saved = await stored(page);
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator(`#${action}`).click();
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBe(saved);
    await expectConflict(page);

    const latest = fixture(' Latest\r\nsaved copy ');
    const latestRaw = rawDraft(latest);
    await put(other, latestRaw);
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain(action === 'load-saved-draft'
        ? 'replace all current fields' : 'replace the current browser-saved copy');
      await dialog.accept();
    });
    await page.locator(`#${action}`).click();
    const chosen = action === 'load-saved-draft' ? latest : fixture('Unsaved local copy');
    expect((await backup(page)).state).toEqual(chosen);
    const resolved = await stored(page);
    if (action === 'load-saved-draft') expect(resolved).toBe(latestRaw);
    else expect(JSON.parse(resolved!).state).toEqual(chosen);
    await expect(page.locator('#completion-count')).toHaveText('12 of 12 sections completed');
    await expect(page.getByRole('button', { name: 'Continue draft', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Load saved draft', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keep this draft', exact: true })).toHaveCount(0);
    await page.clock.runFor(1000);
    expect(await stored(page)).toBe(resolved);
    await page.reload();
    expect((await backup(page)).state).toEqual(chosen);
    await page.locator('#document-title').fill('Ordinary saves resumed');
    await page.clock.runFor(399);
    expect(await stored(page)).toBe(resolved);
    await page.clock.runFor(1);
    expect(JSON.parse((await stored(page))!).state.title).toBe('Ordinary saves resumed');
    await expect(page.locator('#save-status')).toContainText('Draft saved automatically');
  });

  test(`${action} refuses a value changed during confirmation and requires a fresh choice`, async ({ page, context }) => {
    const other = await openPair(page, context);
    await put(other, rawDraft(fixture('Second copy')));
    await expectConflict(page);
    const before = await fields(page);
    const third = rawDraft(fixture('Third copy'));
    // A deterministic confirmation boundary: native dialogs can pause other tabs'
    // script execution in some engines. The post-confirm read must still catch this.
    await page.evaluate(({ key, raw }) => {
      window.confirm = () => { localStorage.setItem(key, raw); return true; };
    }, { key: PRD_EDITOR_STORAGE_KEY, raw: third });
    await page.locator(`#${action}`).click();
    expect(await stored(page)).toBe(third);
    expect(await fields(page)).toEqual(before);
    await expect(page.locator('#save-status')).toContainText('changed again');
    await expectConflict(page);
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator(`#${action}`).click();
    await expect(page.locator('#draft-conflict')).toBeHidden();
    expect(JSON.parse((await stored(page))!).state.title).toBe(
      action === 'load-saved-draft' ? 'Third copy' : 'Original saved draft',
    );
  });
}

for (const removal of ['remove', 'clear']) {
  test(`external ${removal} preserves local work until empty-load confirmation`, async ({ page, context }) => {
    const other = await openPair(page, context);
    const before = await fields(page);
    if (removal === 'clear') await other.evaluate(() => localStorage.clear());
    else await put(other, null);
    await expectConflict(page);
    expect(await fields(page)).toEqual(before);
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('removed in another tab');
      expect(dialog.message()).toContain('clear all current fields');
      await dialog.dismiss();
    });
    await page.locator('#load-saved-draft').click();
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBeNull();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#load-saved-draft').click();
    expect(await fields(page)).toEqual(Array(13).fill(''));
    expect((await backup(page)).state).toEqual(createBlankPrdEditorState());
    await expect(page.locator('#completion-count')).toHaveText('0 of 12 sections completed');
    await expect(page.locator('#save-status')).toContainText('empty draft is now loaded');
    expect(await stored(page)).toBeNull();
    await page.reload();
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'empty');
  });
}

test('invalid external values are never applied and errors identify the invalid payload', async ({ page, context }) => {
  const other = await openPair(page, context);
  const before = await fields(page);
  let dialogs = 0;
  page.on('dialog', async (dialog) => { dialogs += 1; await dialog.dismiss(); });
  for (const [raw, message] of [
    ['{broken', 'not valid JSON'],
    ['{"version":99}', 'unsupported version 99'],
    ['{}', 'missing or damaged version, saved timestamp, or draft structure'],
    [JSON.stringify({ ...createPrdEditorDraftPayload(fixture('Invalid fields')), state: { title: 'Missing sections' } }), 'all 12 sections as text'],
  ]) {
    await put(other, raw);
    await expectConflict(page);
    await page.locator('#load-saved-draft').click();
    await expect(page.locator('#save-status')).toContainText(message);
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBe(raw);
  }
  expect(dialogs).toBe(0);
});

for (const mutation of ['debounce', 'pagehide', 'save', 'start-over']) {
  test(`missed storage events cannot bypass the ${mutation} preflight`, async ({ page, context }) => {
    await missStorageEvents(page);
    const other = await openPair(page, context);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.locator('#document-title').fill('Pending local work');
    const before = await fields(page);
    const newer = rawDraft(fixture('Newer saved copy'));
    await put(other, newer);
    await expect(page.locator('#draft-conflict')).toBeHidden();
    if (mutation === 'debounce') await page.clock.runFor(400);
    else if (mutation === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    else await page.locator(mutation === 'save' ? '#save-draft' : '#start-over').evaluate((button) => {
      if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a draft button');
      button.click();
    });
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBe(newer);
    await expectConflict(page);
  });
}

for (const signal of ['focus', 'visibilitychange']) {
  test(`${signal} return observes changes even when storage events were missed`, async ({ page, context }) => {
    await missStorageEvents(page);
    const other = await openPair(page, context);
    await put(other, rawDraft(fixture('Changed while away')));
    await expect(page.locator('#draft-conflict')).toBeHidden();
    await page.evaluate((signal) => {
      if (signal === 'focus') window.dispatchEvent(new Event('focus'));
      else {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      }
    }, signal);
    await expectConflict(page);
    await expect(page.locator('#document-title')).toHaveValue('Original saved draft');
  });
}

test('storage events ignore unrelated keys and sessionStorage and re-read instead of trusting newValue', async ({ page, context }) => {
  const other = await openPair(page, context);
  await page.evaluate((key) => {
    const original = Storage.prototype.getItem;
    const observed = { reads: 0, unrelated: false };
    Object.assign(window, { observedStorage: observed });
    Storage.prototype.getItem = function (item) {
      if (item === key) observed.reads += 1;
      return original.call(this, item);
    };
    window.addEventListener('storage', (event) => {
      if (event.key === 'unrelated-draft-test') observed.unrelated = true;
    });
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: sessionStorage, newValue: 'not a draft' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: sessionStorage }));
  }, PRD_EDITOR_STORAGE_KEY);
  await other.evaluate(() => localStorage.setItem('unrelated-draft-test', 'not a draft'));
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { observedStorage: { unrelated: boolean } }).observedStorage.unrelated,
  )).toBe(true);
  expect(await page.evaluate(() =>
    (window as typeof window & { observedStorage: { reads: number } }).observedStorage.reads,
  )).toBe(0);
  await page.evaluate((key) => {
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage, newValue: 'delayed old event' }));
  }, PRD_EDITOR_STORAGE_KEY);
  await expect(page.locator('#draft-conflict')).toBeHidden();
  const actual = rawDraft(fixture('Actual latest value'));
  await page.evaluate(({ key, raw }) => {
    const old = localStorage.getItem(key);
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage, newValue: old }));
  }, { key: PRD_EDITOR_STORAGE_KEY, raw: actual });
  await expectConflict(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-saved-draft').click();
  await expect(page.locator('#document-title')).toHaveValue('Actual latest value');
  expect(await stored(page)).toBe(actual);
});

for (const missed of [false, true]) {
  test(`a delayed import cannot replace an external save with ${missed ? 'missed' : 'observed'} events`, async ({ page, context }) => {
    if (missed) await missStorageEvents(page);
    const other = await openPair(page, context);
    await page.evaluate(() => {
      const text = File.prototype.text;
      File.prototype.text = async function () {
        await new Promise<void>((resolve) => Object.assign(window, { finishRead: resolve }));
        return text.call(this);
      };
    });
    await chooseBackup(page, fixture('Delayed import'));
    await expect(page.locator('#import-backup')).toBeDisabled();
    const newer = rawDraft(fixture('Saved during import'));
    await put(other, newer);
    const before = await fields(page);
    await page.evaluate(() =>
      (window as typeof window & { finishRead: () => void }).finishRead(),
    );
    await expect(page.locator('#import-backup')).toBeEnabled();
    await expect(page.locator('#download-status')).toContainText('Import paused');
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBe(newer);
    await expectConflict(page);
    await expect(page.locator('#save-status')).not.toContainText('imported and saved');
  });
}

for (const action of ['import', 'start-over']) {
  test(`${action} confirmation does not authorize a later saved-value change`, async ({ page, context }) => {
    await openPair(page, context);
    const before = await fields(page);
    const newer = rawDraft(fixture('Changed during confirmation'));
    await page.evaluate(({ key, raw }) => {
      window.confirm = () => { localStorage.setItem(key, raw); return true; };
    }, { key: PRD_EDITOR_STORAGE_KEY, raw: newer });
    if (action === 'import') await chooseBackup(page, fixture('Imported backup'));
    else await page.locator('#start-over').click();
    await expectConflict(page);
    expect(await fields(page)).toEqual(before);
    expect(await stored(page)).toBe(newer);
    if (action === 'import') await expect(page.locator('#download-status')).toContainText('Import paused');
  });
}

test('an unreadable initial baseline never becomes permission to overwrite a saved draft', async ({ page, context }) => {
  const other = await openPair(page, context);
  const saved = await stored(other);
  await page.addInitScript((key) => {
    const get = Storage.prototype.getItem;
    const failure = { read: true };
    Object.assign(window, { storageFailure: failure });
    Storage.prototype.getItem = function (item) {
      if (item === key && failure.read) throw new DOMException('Unreadable', 'SecurityError');
      return get.call(this, item);
    };
  }, PRD_EDITOR_STORAGE_KEY);
  await page.reload();
  await expect(page.locator('#save-status')).toContainText('could not read local draft storage');
  await page.locator('#document-title').fill('Unsaved after read failure');
  await expect(page.locator('#save-status')).not.toContainText('Saving in this browser');
  await page.locator('#save-draft').click();
  expect(await stored(other)).toBe(saved);
  await page.evaluate(() => {
    (window as typeof window & { storageFailure: { read: boolean } }).storageFailure.read = false;
  });
  await page.locator('#save-draft').click();
  await expectConflict(page);
  expect(await stored(other)).toBe(saved);
  expect((await backup(page)).state.title).toBe('Unsaved after read failure');
});

test('read and write failures during conflict keep both copies and permit a deliberate retry', async ({ page, context }) => {
  const other = await openPair(page, context);
  const newer = rawDraft(fixture('Saved elsewhere'));
  await put(other, newer);
  await expectConflict(page);
  await page.locator('#document-title').fill('Local copy to keep');
  const before = await fields(page);
  await page.evaluate((key) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const failure = { read: true, write: true };
    Object.assign(window, { storageFailure: failure });
    Storage.prototype.getItem = function (item) {
      if (item === key && failure.read) throw new DOMException('Unreadable', 'SecurityError');
      return get.call(this, item);
    };
    Storage.prototype.setItem = function (item, value) {
      if (item === key && failure.write) throw new DOMException('Full', 'QuotaExceededError');
      return set.call(this, item, value);
    };
  }, PRD_EDITOR_STORAGE_KEY);
  for (const action of ['load-saved-draft', 'keep-this-draft']) {
    await page.locator(`#${action}`).click();
    await expect(page.locator('#save-status')).toContainText('could not read local draft storage');
    expect(await fields(page)).toEqual(before);
    expect(await stored(other)).toBe(newer);
  }
  await page.evaluate(() => {
    (window as typeof window & { storageFailure: { read: boolean } }).storageFailure.read = false;
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#keep-this-draft').click();
  await expect(page.locator('#save-status')).toContainText('Draft could not be saved');
  await expectConflict(page);
  expect(await fields(page)).toEqual(before);
  expect(await stored(other)).toBe(newer);
  expect((await backup(page)).state).toEqual(fixture('Local copy to keep'));
  await page.evaluate(() => {
    (window as typeof window & { storageFailure: { write: boolean } }).storageFailure.write = false;
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#keep-this-draft').click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');
  await page.reload();
  expect((await backup(page)).state).toEqual(fixture('Local copy to keep'));
});

test('conflict actions are compact, keyboard reachable, overflow-free and absent from print', async ({ page, context }) => {
  const other = await openPair(page, context);
  await page.locator('#document-title').focus();
  await put(other, rawDraft(fixture('Saved elsewhere')));
  await expectConflict(page);
  await expect(page.locator('#document-title')).toBeFocused();
  const before = await fields(page);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#start-over').focus();
    for (const id of ['load-saved-draft', 'keep-this-draft', 'download-backup']) {
      await page.keyboard.press('Tab');
      await expect(page.locator(`#${id}`)).toBeFocused();
      const box = await page.locator(`#${id}`).evaluate((button) => {
        button.scrollIntoView({ behavior: 'instant', block: 'center' });
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return { height: rect.height, width: rect.width, left: rect.left, right: rect.right,
          outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
      });
      expect(box.height).toBeGreaterThanOrEqual(32);
      expect(box.width).toBeGreaterThanOrEqual(32);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.outline).not.toBe('none');
      expect(box.outlineWidth).toBeGreaterThan(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await expect(page.locator('#conflict-help')).toContainText('Download a draft backup first');
  await expect(page.locator('[aria-live="polite"]')).toHaveCount(2);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#draft-conflict')).toBeHidden();
  await expect(page.locator('button:visible')).toHaveCount(0);
  expect(await page.locator('[data-prd-print-value]').allTextContents()).toEqual(before.slice(1));
  await expect(page.locator('[data-prd-print-title]')).toHaveText(before[0]);
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  expect(await fields(page)).toEqual(before);
  await expectConflict(page);
});

test('all document formats remain available during conflict with supported Latin font text', async ({ page, context }) => {
  const other = await openPair(page, context);
  const newer = rawDraft(fixture('Newer saved copy'));
  await put(other, newer);
  await expectConflict(page);
  // PDF embeds a Latin font; arbitrary Unicode is covered by backup and print.
  for (const section of PRD_TEMPLATE_SECTIONS) {
    await page.locator(`#section-input-${section.id}`).fill(`Caf\u00e9: ${section.title}\nComplete local text.`);
  }
  const before = await fields(page);
  for (const [format, signature] of [['md', '# '], ['docx', 'PK'], ['pdf', '%PDF-']]) {
    const pending = page.waitForEvent('download');
    await page.locator(`#download-${format}`).click();
    const path = await (await pending).path();
    if (!path) throw new Error('Missing document download');
    expect((await readFile(path)).subarray(0, signature.length).toString()).toBe(signature);
  }
  expect(await fields(page)).toEqual(before);
  expect(await stored(page)).toBe(newer);
  await expectConflict(page);
});

for (const path of ['/prd/', '/prd/create/']) {
  test(`${path} actual navigation cannot flush stale edits after a missed storage event`, async ({ page, context }) => {
    await missStorageEvents(page);
    const other = await openPair(page, context, path);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.locator('#document-title').fill('Pending local work before navigation');
    const newer = rawDraft(fixture('Newer saved copy'));
    await put(other, newer);
    await expect(page.locator('#draft-conflict')).toBeHidden();
    await page.goto('/prd/sample/');
    expect(await stored(other)).toBe(newer);
  });
}

test('a failed removal preserves fields and a later confirmed retry clears them', async ({ page, context }) => {
  await openPair(page, context);
  const before = await fields(page);
  const saved = await stored(page);
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function () {
      Storage.prototype.removeItem = remove;
      throw new DOMException('Cannot remove', 'SecurityError');
    };
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  await expect(page.locator('#save-status')).toContainText('could not be removed');
  expect(await fields(page)).toEqual(before);
  expect(await stored(page)).toBe(saved);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#start-over').click();
  expect(await fields(page)).toEqual(Array(13).fill(''));
  expect(await stored(page)).toBeNull();
});
