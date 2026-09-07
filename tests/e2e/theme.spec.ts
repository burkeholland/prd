import { expect, test, type Page } from '@playwright/test';
import {
  createBlankPrdEditorState,
  createPrdEditorDraftPayload,
  PRD_EDITOR_STORAGE_KEY,
  type PrdEditorState,
} from '../../src/lib/prd-editor-state';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import { THEME_STORAGE_KEY } from '../../src/lib/theme';

const BASE = '/prd';
const to = (path: string) => `${BASE}${path}`;
const ORIGIN = `http://localhost:${Number(process.env.PREVIEW_PORT ?? 4411)}`;
const control = (page: Page) => page.locator('select[data-theme-control]');

const palette = (page: Page) =>
  page.locator('body').evaluate((body) => {
    const style = getComputedStyle(body);
    return { color: style.color, background: style.backgroundColor };
  });

const LIGHT = { color: 'rgb(29, 30, 27)', background: 'rgb(251, 251, 248)' };
const DARK = { color: 'rgb(231, 232, 226)', background: 'rgb(20, 22, 20)' };

declare global {
  interface Window {
    __themeAtFirstFrame?: string;
    __themeWrites?: string[];
  }
}

test('every page has one progressive Theme select with the three choices in order', async ({ page }) => {
  for (const path of [
    '/',
    '/create/',
    '/guide/',
    '/history/',
    '/history/3/',
    '/sample/',
    '/template/',
    '/walkthrough/',
    '/nope/',
  ]) {
    const response = await page.goto(to(path));
    expect(response?.status(), `${path} status`).toBe(path === '/nope/' ? 404 : 200);
    await expect(control(page), `${path} theme control`).toHaveCount(1);
    await expect(control(page).locator('option'), `${path} theme choices`).toHaveText([
      'System',
      'Light',
      'Dark',
    ]);
    await expect(control(page), `${path} accessible name`).toHaveAccessibleName('Theme');
  }
});

test('fresh and invalid preferences initialize as System without a storage write', async ({ browser }) => {
  for (const initial of [null, 'sepia']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(
      ({ key, initial }) => {
        if (initial !== null) window.localStorage.setItem(key, initial);
        const writes: string[] = [];
        Object.defineProperty(window, '__themeWrites', { value: writes });
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (storageKey, value) {
          if (this === window.localStorage && storageKey === key) writes.push(value);
          return setItem.call(this, storageKey, value);
        };
      },
      { key: THEME_STORAGE_KEY, initial },
    );

    await page.goto(`${ORIGIN}${to('/guide/')}`);
    await expect(control(page)).toHaveValue('system');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    expect(await page.evaluate(() => window.__themeWrites ?? [])).toEqual([]);
    expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe(initial);
    await context.close();
  }
});

test('an explicit theme applies immediately and persists across navigation and reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.requestAnimationFrame(() => {
      window.__themeAtFirstFrame = document.documentElement.dataset.theme;
    });
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(to('/guide/'));

  await control(page).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await palette(page)).toEqual(DARK);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');

  await page.getByRole('link', { name: 'Example', exact: true }).click();
  await expect(control(page)).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => window.__themeAtFirstFrame)).toBe('dark');
  expect(await palette(page)).toEqual(DARK);

  await page.reload();
  await expect(control(page)).toHaveValue('dark');
  expect(await page.evaluate(() => window.__themeAtFirstFrame)).toBe('dark');
  expect(await palette(page)).toEqual(DARK);
});

test('System follows device changes while explicit Light and Dark ignore them', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(to('/guide/'));
  await expect(control(page)).toHaveValue('system');
  expect(await palette(page)).toEqual(LIGHT);

  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await palette(page)).toEqual(DARK);

  await control(page).selectOption('light');
  expect(await palette(page)).toEqual(LIGHT);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await palette(page)).toEqual(LIGHT);

  await control(page).selectOption('dark');
  expect(await palette(page)).toEqual(DARK);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await palette(page)).toEqual(DARK);

  await control(page).selectOption('system');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await palette(page)).toEqual(LIGHT);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('system');
});

test('each explicit selection performs one theme-key storage write', async ({ page }) => {
  await page.addInitScript((key) => {
    const writes: string[] = [];
    Object.defineProperty(window, '__themeWrites', { value: writes });
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (this === window.localStorage && storageKey === key) writes.push(value);
      return setItem.call(this, storageKey, value);
    };
  }, THEME_STORAGE_KEY);
  await page.goto(to('/guide/'));

  for (const preference of ['dark', 'light', 'system']) {
    await control(page).selectOption(preference);
    expect(
      await page.evaluate(() => (window.__themeWrites ?? []).splice(0)),
    ).toEqual([preference]);
  }
});

test('denied storage has no uncaught error and the current-page selection still applies', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage denied', 'SecurityError');
      },
    });
  });

  await page.goto(to('/guide/'));
  await expect(control(page)).toHaveValue('system');
  await control(page).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await palette(page)).toEqual(DARK);
  expect(errors).toEqual([]);
});

test('theme changes leave all editor fields, progress, exports, backups, and draft bytes unchanged', async ({
  page,
}) => {
  type MutableValues = {
    -readonly [Id in keyof PrdEditorState['values']]: string;
  };
  const blank = createBlankPrdEditorState();
  const values: MutableValues = { ...blank.values };
  for (const [index, section] of PRD_TEMPLATE_SECTIONS.entries()) {
    values[section.id] = `Theme isolation section ${index + 1}`;
  }
  const state: PrdEditorState = { title: 'Theme isolation title', values };
  const raw = JSON.stringify(createPrdEditorDraftPayload(state, new Date('2026-09-07T12:00:00.000Z')));

  await page.goto(to('/'));
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: PRD_EDITOR_STORAGE_KEY, raw },
  );
  await page.reload();

  const snapshot = () =>
    page.evaluate((draftKey) => ({
      fields: Array.from(
        document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          '#prd-editor-form input[type="text"], #prd-editor-form textarea',
        ),
        (field) => field.value,
      ),
      progress: document.querySelector('#completion-count')?.textContent,
      exports: Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-export-format]'),
        (button) => ({ format: button.dataset.exportFormat, disabled: button.disabled }),
      ),
      backups: Array.from(
        document.querySelectorAll<HTMLButtonElement>('#download-backup, #import-backup'),
        (button) => ({ id: button.id, disabled: button.disabled }),
      ),
      draft: localStorage.getItem(draftKey),
    }), PRD_EDITOR_STORAGE_KEY);

  const before = await snapshot();
  expect(before.fields).toEqual([state.title, ...Object.values(state.values)]);
  expect(before.progress).toBe('12 of 12 sections completed');

  await control(page).selectOption('dark');
  expect(await snapshot()).toEqual(before);
});

test('control follows the nav in keyboard order and fits without overlap or page overflow', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', "WebKit skips links in sequential focus navigation by default");

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(to('/guide/'));

    const picker = control(page);
    const box = await picker.boundingBox();
    expect(box?.width, `${width} control width`).toBeGreaterThanOrEqual(32);
    expect(box?.height, `${width} control height`).toBeGreaterThanOrEqual(32);
    const geometry = await page.locator('.site-header').evaluate((header) => {
      const rects = Array.from(
        header.querySelectorAll<HTMLElement>('a, select'),
        (element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.textContent?.trim() ?? '',
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            clipped: element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
          };
        },
      );
      const overlaps: string[] = [];
      for (let first = 0; first < rects.length; first += 1) {
        for (let second = first + 1; second < rects.length; second += 1) {
          const a = rects[first];
          const b = rects[second];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
            overlaps.push(`${a.label}/${b.label}`);
          }
        }
      }
      return {
        overlaps,
        clipped: rects.filter((rect) => rect.clipped).map((rect) => rect.label),
        outside: rects.filter((rect) => rect.left < 0 || rect.right > innerWidth).map((rect) => rect.label),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    expect(geometry).toEqual({
      overlaps: [],
      clipped: [],
      outside: [],
      scrollWidth: width,
      viewport: width,
    });
  }

  await page.locator('.site-nav a').last().focus();
  await page.keyboard.press('Tab');
  await expect(control(page)).toBeFocused();
  const focus = await control(page).evaluate((select) => {
    const style = getComputedStyle(select);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).not.toBe('0px');
});

test('without JavaScript there is no theme control and system colors still follow the device', async ({
  browser,
  page,
}) => {
  await page.goto(to('/guide/'));
  const origin = new URL(page.url()).origin;
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const noScriptPage = await context.newPage();
  await noScriptPage.goto(`${origin}${to('/guide/')}`);

  await expect(noScriptPage.locator('select[data-theme-control]')).toHaveCount(0);
  expect(await palette(noScriptPage)).toEqual(DARK);
  await context.close();
});

test('the theme control is absent from print', async ({ page }) => {
  await page.goto(to('/guide/'));
  await expect(control(page)).toBeVisible();
  await control(page).selectOption('dark');
  await page.emulateMedia({ media: 'print' });
  await expect(control(page)).toBeHidden();
  expect(await palette(page)).toEqual({
    color: 'rgb(0, 0, 0)',
    background: 'rgb(255, 255, 255)',
  });
});
