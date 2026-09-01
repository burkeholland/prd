#!/usr/bin/env node
// Renders scripts/og.html once per entry of SOCIAL_CARDS (src/lib/seo.ts) to public/og.png and
// public/og/<page>.png (1200×630), the social preview images the pages point at (og:image /
// twitter:image, see src/layouts/Base.astro).
//
// Needs the project's dependencies: `npm ci` first (Playwright + its Chromium). Then, from the
// repo root: `node scripts/make-og.mjs`. Prints one line per file and exits 0; exits 1 when any
// image is not 1200×630, weighs 200 KB or more (the e2e suite asserts the same limits) or its
// copy overflows the card.
//
// The home card keeps title = SITE.name and no eyebrow, so it renders exactly as before; the page
// cards put SITE.name in the eyebrow, the card title in the h1 and its subtitle in the tagline.
// Copy that would wrap the title past two lines or the subtitle past three is shrunk, never cut.
// Text comes from SITE (src/lib/site.ts) and SOCIAL_CARDS (Node 24 strips the types), so the
// images can never drift from the site copy. Commit the regenerated PNGs.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { SOCIAL_CARDS } from '../src/lib/seo.ts';
import { SITE } from '../src/lib/site.ts';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 200_000;
const MAX_TITLE_LINES = 2;
const MAX_SUBTITLE_LINES = 3;

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'og.html');
const publicDir = resolve(here, '..', 'public');

/** Width and height from a PNG's IHDR chunk (big-endian, bytes 16–23). */
function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Runs in the page: fills the three text slots, then shrinks the title/subtitle font until each
 * fits its line budget and the whole card fits the viewport. Returns what it measured.
 */
function layoutCard({ eyebrow, title, subtitle, maxTitleLines, maxSubtitleLines, height }) {
  const slot = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`og.html has no #${id}`);
    return el;
  };
  const px = (el, property) => parseFloat(getComputedStyle(el)[property]);
  const lines = (el) => {
    const lineHeight = px(el, 'lineHeight');
    return Math.round(el.getBoundingClientRect().height / (Number.isNaN(lineHeight) ? px(el, 'fontSize') * 1.2 : lineHeight));
  };
  const shrink = (el, step) => {
    el.style.fontSize = `${px(el, 'fontSize') - step}px`;
  };
  const overflows = () => document.documentElement.scrollHeight > height;

  const eyebrowEl = slot('eyebrow');
  const titleEl = slot('title');
  const subtitleEl = slot('tagline');
  eyebrowEl.textContent = eyebrow;
  titleEl.textContent = title;
  subtitleEl.textContent = subtitle;

  for (let i = 0; i < 12 && lines(titleEl) > maxTitleLines; i++) shrink(titleEl, 4);
  for (let i = 0; i < 12 && lines(subtitleEl) > maxSubtitleLines; i++) shrink(subtitleEl, 2);
  // A two-line title over a three-line subtitle can still be too tall together: tighten the subtitle.
  for (let i = 0; i < 12 && overflows(); i++) shrink(subtitleEl, 2);

  return {
    titleLines: lines(titleEl),
    titlePx: px(titleEl, 'fontSize'),
    subtitleLines: lines(subtitleEl),
    subtitlePx: px(subtitleEl, 'fontSize'),
    scrollHeight: document.documentElement.scrollHeight,
  };
}

const rendered = [];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (const [route, card] of Object.entries(SOCIAL_CARDS)) {
    const target = resolve(publicDir, `.${card.file}`);
    await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
    const fit = await page.evaluate(layoutCard, {
      eyebrow: route === '/' ? '' : SITE.name,
      title: card.title,
      subtitle: card.subtitle,
      maxTitleLines: MAX_TITLE_LINES,
      maxSubtitleLines: MAX_SUBTITLE_LINES,
      height: HEIGHT,
    });
    if (fit.scrollHeight > HEIGHT) {
      console.error(`public${card.file}: the copy overflows the card (${fit.scrollHeight}px > ${HEIGHT}px)`);
      process.exit(1);
    }
    mkdirSync(dirname(target), { recursive: true });
    await page.screenshot({ path: target, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    rendered.push({ file: `public${card.file}`, target, fit });
  }
} finally {
  await browser.close();
}

let failed = false;
for (const { file, target, fit } of rendered) {
  const png = readFileSync(target);
  const { width, height } = pngSize(png);
  const kb = (png.length / 1024).toFixed(1);
  if (width !== WIDTH || height !== HEIGHT || png.length >= MAX_BYTES) {
    console.error(`${file} is ${width}×${height}, ${kb} KB — expected ${WIDTH}×${HEIGHT} under ${MAX_BYTES / 1000} KB`);
    failed = true;
    continue;
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const copy = `title ${plural(fit.titleLines, 'line')} at ${fit.titlePx}px, subtitle ${plural(fit.subtitleLines, 'line')} at ${fit.subtitlePx}px`;
  console.log(`${file} ${width}×${height}, ${kb} KB (${copy})`);
}
if (failed) process.exit(1);
