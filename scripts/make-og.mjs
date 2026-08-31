#!/usr/bin/env node
// Renders scripts/og.html to public/og.png (1200×630), the social preview image every page
// points at (og:image / twitter:image, see src/layouts/Base.astro and src/lib/seo.ts).
//
// Needs the project's dependencies: `npm ci` first (Playwright + its Chromium). Then, from the
// repo root: `node scripts/make-og.mjs`. Exits 0 and prints the size; exits 1 when the image is
// not 1200×630 or weighs 200 KB or more (the e2e suite asserts the same limits).
//
// The tagline is re-applied from SITE.tagline (src/lib/site.ts; Node 24 strips the types) so
// the image can never drift from the site copy. Commit the regenerated PNG.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { SITE } from '../src/lib/site.ts';

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 200_000;

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, 'og.html');
const target = resolve(here, '..', 'public', 'og.png');

/** Width and height from a PNG's IHDR chunk (big-endian, bytes 16–23). */
function pngSize(bytes) {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  await page.evaluate((tagline) => {
    const el = document.getElementById('tagline');
    if (el) el.textContent = tagline;
  }, SITE.tagline);
  await page.screenshot({ path: target, type: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
} finally {
  await browser.close();
}

const png = readFileSync(target);
const { width, height } = pngSize(png);
const kb = (png.length / 1024).toFixed(1);
if (width !== WIDTH || height !== HEIGHT || png.length >= MAX_BYTES) {
  console.error(`public/og.png is ${width}×${height}, ${kb} KB — expected ${WIDTH}×${HEIGHT} under ${MAX_BYTES / 1000} KB`);
  process.exit(1);
}
console.log(`public/og.png ${width}×${height}, ${kb} KB`);
