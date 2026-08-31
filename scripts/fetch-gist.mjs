#!/usr/bin/env node
// Snapshot a GitHub gist (markdown + its user-attachment screenshots) into
// this repo so the site builds without the network. Zero dependencies.
//
//   node scripts/fetch-gist.mjs [--gist <id>] [--out <repo root>] [--dry-run]
//
// Writes (idempotently):
//   public/raw/<file>.md        the gist file, byte-for-byte verbatim
//   content/gist/<file>.md      same text, <img> sources rewritten to /mocks/NN-slug.png
//   public/mocks/NN-slug.png    the screenshots (validated PNG, > 10 000 bytes)
//   content/gist/meta.json      gist metadata + image list
//
// Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GIST_ID,
  buildMeta,
  extractImages,
  imageFileName,
  isPng,
  pickGistFile,
  rewriteImageSources,
} from './lib/gist.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0.0.0 Safari/537.36 prd-field-guide/fetch-gist';
const MIN_IMAGE_BYTES = 10_000;
const MOCK_FILE_RE = /^\d{2}-[a-z0-9-]+\.png$/;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: node scripts/fetch-gist.mjs [--gist <id>] [--out <repo root>] [--dry-run]

  --gist <id>   gist id (default ${DEFAULT_GIST_ID})
  --out <dir>   repo root to write into (default: this script's repo root)
  --dry-run     fetch and validate, print the plan, write nothing
  -h, --help    show this help`;

class UsageError extends Error {}
class FetchError extends Error {}

function parseArgs(argv) {
  const opts = {
    gist: DEFAULT_GIST_ID,
    out: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    dryRun: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const takeValue = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${name} needs a value`);
      return v;
    };
    if (arg === '--gist') opts.gist = takeValue(arg);
    else if (arg.startsWith('--gist=')) opts.gist = arg.slice('--gist='.length);
    else if (arg === '--out') opts.out = path.resolve(takeValue(arg));
    else if (arg.startsWith('--out=')) opts.out = path.resolve(arg.slice('--out='.length));
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]+$/i.test(opts.gist)) throw new UsageError(`--gist must be a hex gist id, got "${opts.gist}"`);
  return opts;
}

async function fetchGistApi(id) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Optional: raises the unauthenticated 60 req/h limit. The value is never logged.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const url = `https://api.github.com/gists/${id}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const hint = remaining === '0' ? ' (rate limited — set GITHUB_TOKEN to raise the limit)' : '';
    throw new FetchError(`GET ${url} → HTTP ${res.status}${hint}`);
  }
  return res.json();
}

async function fetchBytes(url, accept) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'follow' });
  if (!res.ok) throw new FetchError(`GET ${url} → HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchImage(image) {
  const label = `image ${image.n} (${imageFileName(image)}) ${image.source}`;
  let bytes;
  try {
    bytes = await fetchBytes(image.source, 'image/png,image/*;q=0.9,*/*;q=0.8');
  } catch (err) {
    throw new FetchError(`${label}: ${err.message}`);
  }
  if (!isPng(bytes)) throw new FetchError(`${label}: not a PNG (magic bytes mismatch)`);
  if (bytes.length <= MIN_IMAGE_BYTES) throw new FetchError(`${label}: only ${bytes.length} bytes (need > ${MIN_IMAGE_BYTES})`);
  return bytes;
}

async function readIfExists(file) {
  try {
    return await readFile(file);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Keep the previous fetched_at when nothing but the timestamp would change. */
async function reuseFetchedAt(meta, metaFile) {
  const previous = await readIfExists(metaFile);
  if (!previous) return meta;
  let old;
  try {
    old = JSON.parse(previous.toString('utf8'));
  } catch {
    return meta;
  }
  const strip = (m) => JSON.stringify({ ...m, fetched_at: null });
  if (typeof old?.fetched_at === 'string' && strip(old) === strip(meta)) {
    return { ...meta, fetched_at: old.fetched_at };
  }
  return meta;
}

function rel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, file);
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const api = await fetchGistApi(opts.gist);
  const file = pickGistFile(api);
  if (!file?.raw_url) throw new FetchError(`gist ${opts.gist} has no downloadable file`);
  if (file.truncated) throw new FetchError(`gist file ${file.filename} is truncated by the API`);

  const raw = await fetchBytes(file.raw_url, 'text/plain,*/*;q=0.8');
  if (raw.length === 0) throw new FetchError(`raw download of ${file.filename} is empty`);
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    throw new FetchError(`${file.filename} is not valid UTF-8; refusing to rewrite it`);
  }

  const images = extractImages(text);
  const rewritten = rewriteImageSources(text, images);
  const fetchedAt = new Date().toISOString();
  const pngs = await Promise.all(images.map(fetchImage));

  const root = opts.out;
  const rawDir = path.join(root, 'public', 'raw');
  const mocksDir = path.join(root, 'public', 'mocks');
  const gistDir = path.join(root, 'content', 'gist');
  const metaFile = path.join(gistDir, 'meta.json');
  const meta = await reuseFetchedAt(buildMeta(api, images, fetchedAt), metaFile);

  const plan = [
    { file: path.join(rawDir, file.filename), bytes: raw },
    { file: path.join(gistDir, file.filename), bytes: Buffer.from(rewritten, 'utf8') },
    ...images.map((img, i) => ({ file: path.join(mocksDir, imageFileName(img)), bytes: pngs[i] })),
    { file: metaFile, bytes: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf8') },
  ];

  // Stale NN-slug.png files from an earlier revision of the gist.
  const keep = new Set(images.map(imageFileName));
  const existing = (await readdir(mocksDir).catch(() => [])).filter((f) => MOCK_FILE_RE.test(f) && !keep.has(f));

  const verb = opts.dryRun ? 'would write' : 'wrote';
  console.log(
    `gist ${meta.id} (${meta.owner}) revision ${meta.revision} — ${file.filename}, ${images.length} image(s)` +
      (opts.dryRun ? ' [dry run]' : ''),
  );
  for (const { file: target, bytes } of plan) {
    const before = await readIfExists(target);
    const state = before === null ? 'new' : before.equals(bytes) ? 'unchanged' : 'updated';
    if (!opts.dryRun) await writeAtomic(target, bytes);
    console.log(`${verb} ${rel(root, target)} ${bytes.length} bytes (${state})`);
  }
  for (const stale of existing) {
    const target = path.join(mocksDir, stale);
    if (!opts.dryRun) await unlink(target);
    console.log(`${opts.dryRun ? 'would remove' : 'removed'} ${rel(root, target)} (stale)`);
  }
  console.log(`${opts.dryRun ? 'planned' : 'done:'} ${plan.length} files, fetched_at ${meta.fetched_at}`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  } else {
    console.error(`error: ${err?.message ?? err}`);
    process.exitCode = EXIT_FAIL;
  }
}
