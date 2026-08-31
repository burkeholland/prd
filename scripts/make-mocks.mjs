#!/usr/bin/env node
// Derives lighter WebP copies of the gist screenshots so /sample can serve them through
// <picture> (src/lib/rehype-figures.mjs) with the original PNG as the fallback.
//
//   node scripts/make-mocks.mjs [--force] [--src <dir>] [--out <dir>]
//
// For every public/mocks/*.png it writes public/mocks/derived/<stem>-760.webp and
// public/mocks/derived/<stem>-1320.webp (resized, never enlarged). It never writes into
// public/mocks/ itself: the PNGs there are byte-verbatim copies of the gist that the daily
// fetch workflow overwrites, and public/mocks/derived/ is gitignored, so the copies are
// rebuilt from whatever the PNGs are on every `npm run build` / `npm run dev` (prebuild /
// predev) — nothing to commit, nothing that can go stale.
//
// A derived file whose mtime is not older than its source is left alone (`--force` rewrites
// everything). One line per derived file: `written` / `up to date` and its size in bytes.
// Exit codes: 0 ok · 1 a source ended up without both derived files (or sharp failed).
//
// Needs `sharp` (devDependency, the same build Astro's image service uses).

import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Widths of the derived copies, in CSS px × DPR terms: 760 covers a phone at DPR 2 and a
 * desktop column at DPR 1; 1320 covers the desktop column at DPR 2. */
export const WIDTHS = [760, 1320];

/** Lossy WebP at quality 85 keeps the screenshots' UI text crisp at 1:1 (checked on a crop of
 * 05-my-lists-logged-in) at roughly a fifth of the PNG bytes; `nearLossless` was 2–3× larger
 * and, at 1320 px, larger than the PNG itself. */
export const WEBP = { quality: 85 };

const SOURCE_RE = /\.png$/i;
const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SRC = path.resolve(here, '..', 'public', 'mocks');
export const DEFAULT_OUT = path.join(DEFAULT_SRC, 'derived');

/**
 * Name of a derived copy: `01-home-page.png` → `01-home-page-760.webp`.
 * @param {string} file source file name (PNG)
 * @param {number} width
 * @returns {string}
 */
export function derivedName(file, width) {
  return `${file.replace(SOURCE_RE, '')}-${width}.webp`;
}

/**
 * Both derived names for a source file, in `WIDTHS` order.
 * @param {string} file
 * @returns {string[]}
 */
export function derivedNames(file) {
  return WIDTHS.map((width) => derivedName(file, width));
}

/**
 * The skip decision: a derived file is up to date when it exists and is not older than its
 * source; `--force` always rebuilds.
 * @param {number | null | undefined} derivedMtimeMs mtime of the derived file, or null/undefined when it does not exist
 * @param {number} sourceMtimeMs
 * @param {{ force?: boolean }} [options]
 * @returns {boolean}
 */
export function isUpToDate(derivedMtimeMs, sourceMtimeMs, { force = false } = {}) {
  if (force) return false;
  if (derivedMtimeMs === null || derivedMtimeMs === undefined) return false;
  return derivedMtimeMs >= sourceMtimeMs;
}

/** @param {string} file @returns {Promise<import('node:fs').Stats | null>} */
async function statOrNull(file) {
  return stat(file).catch(() => null);
}

/** sharp's native binary takes ~100 ms to load, so it is imported only when there is something to write. */
let sharpModule;
async function loadSharp() {
  sharpModule ??= (await import('sharp')).default;
  return sharpModule;
}

/** Path relative to the cwd with forward slashes, for the log lines. */
function rel(file) {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

/**
 * Derives the WebP copies of every PNG in `src` into `out`.
 * @param {{ src?: string, out?: string, force?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ sources: string[], written: string[], upToDate: string[], missing: string[] }>}
 *   `missing` lists derived files that do not exist after the run (should be empty).
 */
export async function makeMocks({ src = DEFAULT_SRC, out = DEFAULT_OUT, force = false, log = console.log } = {}) {
  const sources = (await readdir(src)).filter((file) => SOURCE_RE.test(file)).sort();
  const written = [];
  const upToDate = [];
  const missing = [];
  if (sources.length > 0) await mkdir(out, { recursive: true });

  for (const file of sources) {
    const source = path.join(src, file);
    const sourceStat = await stat(source);
    for (const width of WIDTHS) {
      const target = path.join(out, derivedName(file, width));
      const before = await statOrNull(target);
      if (isUpToDate(before?.mtimeMs, sourceStat.mtimeMs, { force })) {
        upToDate.push(target);
        log(`up to date ${rel(target)} ${before.size} bytes`);
        continue;
      }
      const sharp = await loadSharp();
      const info = await sharp(source).resize({ width, withoutEnlargement: true }).webp(WEBP).toFile(target);
      written.push(target);
      log(`written ${rel(target)} ${info.size} bytes`);
    }
  }

  for (const file of sources) {
    for (const name of derivedNames(file)) {
      const target = path.join(out, name);
      if (!existsSync(target)) missing.push(target);
    }
  }
  return { sources, written, upToDate, missing };
}

function parseArgs(argv) {
  const opts = { src: DEFAULT_SRC, out: DEFAULT_OUT, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') opts.force = true;
    else if (arg === '--src' || arg === '--out') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = path.resolve(value);
    } else throw new Error(`unknown argument ${arg}`);
  }
  return opts;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const { sources, missing } = await makeMocks(opts);
  if (sources.length === 0) {
    console.error(`make-mocks: no PNG files in ${rel(opts.src)}`);
    return 1;
  }
  if (missing.length > 0) {
    console.error(`make-mocks: ${missing.length} derived file(s) missing: ${missing.map(rel).join(', ')}`);
    return 1;
  }
  return 0;
}

/** True when this file is the process entry point (not when imported by a test). */
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const a = realpathSync(entry);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`make-mocks: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
