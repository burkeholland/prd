#!/usr/bin/env node
// Snapshot a GitHub gist (markdown + its user-attachment screenshots) into
// this repo so the site builds without the network. Zero dependencies beyond
// Node and the `git` binary.
//
//   node scripts/fetch-gist.mjs [--gist <id>] [--out <repo root>] [--owner <login>] [--description <text>] [--dry-run]
//
// The gist is read by cloning its git repository (anonymous, ~1 s, no REST
// API, no token, no API rate limit); only the screenshots are plain HTTPS
// downloads. Git does not record a gist's owner or description, so those come
// from --owner/--description, else the existing content/gist/meta.json, else
// the default owner.
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
  DEFAULT_OWNER,
  buildMeta,
  extractImages,
  imageFileName,
  isPng,
  pickGistFile,
  rewriteImageSources,
} from './lib/gist.mjs';
import { blob, blobSha, files, log, withGistClone } from './lib/gist-git.mjs';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/128.0.0.0 Safari/537.36 prd-field-guide/fetch-gist';
const MIN_IMAGE_BYTES = 10_000;
const MOCK_FILE_RE = /^\d{2}-[a-z0-9-]+\.png$/;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: node scripts/fetch-gist.mjs [--gist <id>] [--out <repo root>] [--owner <login>] [--description <text>] [--dry-run]

  --gist <id>           gist id (default ${DEFAULT_GIST_ID})
  --out <dir>           repo root to write into (default: this script's repo root)
  --owner <login>       gist owner (default: the existing content/gist/meta.json, else ${DEFAULT_OWNER})
  --description <text>  gist description (default: the existing content/gist/meta.json, else none)
  --dry-run             fetch and validate, print the plan, write nothing
  -h, --help            show this help`;

class UsageError extends Error {}
class FetchError extends Error {}

function parseArgs(argv) {
  const opts = {
    gist: DEFAULT_GIST_ID,
    out: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    owner: null,
    description: null,
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
    else if (arg === '--owner') opts.owner = takeValue(arg);
    else if (arg.startsWith('--owner=')) opts.owner = arg.slice('--owner='.length);
    else if (arg === '--description') opts.description = takeValue(arg);
    else if (arg.startsWith('--description=')) opts.description = arg.slice('--description='.length);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]+$/i.test(opts.gist)) throw new UsageError(`--gist must be a hex gist id, got "${opts.gist}"`);
  if (opts.owner !== null && !/^[A-Za-z0-9-]+$/.test(opts.owner)) {
    throw new UsageError(`--owner must be a GitHub login, got "${opts.owner}"`);
  }
  return opts;
}

/** The file at HEAD of the gist's git repository, plus what meta.json records about it. */
async function readGistHead(id) {
  return withGistClone(id, async (dir) => {
    const head = (await log(dir)).at(-1);
    if (!head) throw new FetchError(`gist ${id} has no commits`);
    const filename = pickGistFile(await files(dir, head.version));
    if (!filename) throw new FetchError(`gist ${id} has no downloadable file`);
    return {
      filename,
      revision: head.version,
      updated_at: head.committed_at,
      blob_sha: await blobSha(dir, head.version, filename),
      raw: await blob(dir, head.version, filename),
    };
  });
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

async function readJsonIfExists(file) {
  const bytes = await readIfExists(file);
  if (!bytes) return null;
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

/** Keep the previous fetched_at when nothing but the timestamp would change. */
function reuseFetchedAt(meta, old) {
  if (!old || typeof old !== 'object') return meta;
  const strip = (m) => JSON.stringify({ ...m, fetched_at: null });
  if (typeof old.fetched_at === 'string' && strip(old) === strip(meta)) {
    return { ...meta, fetched_at: old.fetched_at };
  }
  return meta;
}

/**
 * Owner and description are not in the gist's git history: a flag wins, then
 * the previous meta.json of the same gist, then the default owner / no description.
 */
function ownerAndDescription(opts, previous) {
  const same = previous?.id === opts.gist ? previous : null;
  const inherited = (key) => (typeof same?.[key] === 'string' ? same[key] : null);
  return {
    owner: opts.owner ?? inherited('owner') ?? DEFAULT_OWNER,
    description: opts.description ?? inherited('description'),
  };
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

  const root = opts.out;
  const rawDir = path.join(root, 'public', 'raw');
  const mocksDir = path.join(root, 'public', 'mocks');
  const gistDir = path.join(root, 'content', 'gist');
  const metaFile = path.join(gistDir, 'meta.json');
  const previous = await readJsonIfExists(metaFile);
  const { owner, description } = ownerAndDescription(opts, previous);

  const head = await readGistHead(opts.gist);
  const { filename, raw } = head;
  if (raw.length === 0) throw new FetchError(`${filename} is empty at revision ${head.revision}`);
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    throw new FetchError(`${filename} is not valid UTF-8; refusing to rewrite it`);
  }

  const images = extractImages(text);
  const rewritten = rewriteImageSources(text, images);
  const fetchedAt = new Date().toISOString();
  const pngs = await Promise.all(images.map(fetchImage));

  const meta = reuseFetchedAt(
    buildMeta(
      { id: opts.gist, owner, description, filename, revision: head.revision, updated_at: head.updated_at, blob_sha: head.blob_sha },
      images,
      fetchedAt,
    ),
    previous,
  );

  const plan = [
    { file: path.join(rawDir, filename), bytes: raw },
    { file: path.join(gistDir, filename), bytes: Buffer.from(rewritten, 'utf8') },
    ...images.map((img, i) => ({ file: path.join(mocksDir, imageFileName(img)), bytes: pngs[i] })),
    { file: metaFile, bytes: Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, 'utf8') },
  ];

  // Stale NN-slug.png files from an earlier revision of the gist.
  const keep = new Set(images.map(imageFileName));
  const existing = (await readdir(mocksDir).catch(() => [])).filter((f) => MOCK_FILE_RE.test(f) && !keep.has(f));

  const verb = opts.dryRun ? 'would write' : 'wrote';
  console.log(
    `gist ${meta.id} (${meta.owner}) revision ${meta.revision} — ${filename}, ${images.length} image(s)` +
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
