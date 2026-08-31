// Pure helpers for snapshotting a GitHub gist and its user-attachment images.
// No I/O and no dependencies beyond the language, so everything here is unit
// testable offline (see gist.test.mjs).

export const DEFAULT_GIST_ID = 'f71d1156812fd91e4369308358892817';
/** A gist's git history does not record its owner; this is the login used when nothing else says. */
export const DEFAULT_OWNER = 'burkeholland';

/** URL prefixes GitHub uses for images pasted into a gist/issue editor. */
const USER_ATTACHMENT_PREFIXES = [
  'https://gist.github.com/user-attachments/assets/',
  'https://github.com/user-attachments/assets/',
];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// `<img ...>` — quoted attribute values may contain `>`.
const IMG_TAG_RE = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
// `#### Heading` — exactly four hashes followed by whitespace.
const H4_RE = /^####[ \t]+(.*?)[ \t]*$/;
// name, optionally `= "dq" | 'sq' | unquoted`
const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** `"My Lists (Logged In)"` → `my-lists-logged-in`. */
export function slugify(heading) {
  const runs = String(heading ?? '').toLowerCase().match(/[a-z0-9]+/g);
  return runs ? runs.join('-') : '';
}

export function isUserAttachmentUrl(url) {
  return typeof url === 'string' && USER_ATTACHMENT_PREFIXES.some((p) => url.startsWith(p));
}

/** `{ n: 1, slug: 'home-page' }` → `01-home-page.png` */
export function imageFileName(image) {
  return `${String(image.n).padStart(2, '0')}-${image.slug}.png`;
}

/** `{ n: 1, slug: 'home-page' }` → `/mocks/01-home-page.png` (the site URL). */
export function imagePublicPath(image) {
  return `/mocks/${imageFileName(image)}`;
}

/**
 * Parse the attributes of one `<img ...>` tag.
 * Returns a map of lowercase name → { value, start, end } where start/end are
 * absolute offsets of the value inside the source document (so callers can
 * splice the value without touching any other byte).
 */
function parseImgAttributes(tagText, tagStart) {
  const attrs = {};
  const body = tagText.replace(/^<img\b/i, '');
  const bodyOffset = tagStart + (tagText.length - body.length);
  ATTR_RE.lastIndex = 0;
  for (const m of body.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (name === '/' || name === '>' || name in attrs) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    const quoted = m[2] !== undefined || m[3] !== undefined;
    const end = bodyOffset + m.index + m[0].length - (quoted ? 1 : 0);
    attrs[name] = { value, start: end - value.length, end };
  }
  return attrs;
}

/** Yield `{ start, end, attrs }` for every `<img>` tag, in document order. */
function* scanImgTags(markdown) {
  IMG_TAG_RE.lastIndex = 0;
  for (const m of markdown.matchAll(IMG_TAG_RE)) {
    yield { start: m.index, end: m.index + m[0].length, attrs: parseImgAttributes(m[0], m.index) };
  }
}

/** Nearest `####` heading text that ends before `offset`, or null. */
function precedingH4(markdown, offset) {
  const before = markdown.slice(0, offset).split(/\r?\n/);
  for (let i = before.length - 1; i >= 0; i--) {
    const m = H4_RE.exec(before[i]);
    if (m) return m[1].replace(/[ \t]+#+$/, '').trim();
  }
  return null;
}

function toDimension(attr) {
  if (!attr) return null;
  const n = Number.parseInt(attr.value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * All `<img>` tags whose `src` is a GitHub user-attachments URL, in order of
 * appearance: `[{ n, slug, alt, width, height, source, heading }]`.
 * `slug` is the kebab-case of the nearest preceding `####` heading (falls back
 * to the alt text, then `image`).
 */
export function extractImages(markdown) {
  const images = [];
  for (const tag of scanImgTags(markdown)) {
    const src = tag.attrs.src?.value;
    if (!isUserAttachmentUrl(src)) continue;
    const heading = precedingH4(markdown, tag.start);
    const alt = tag.attrs.alt?.value ?? '';
    images.push({
      n: images.length + 1,
      slug: slugify(heading) || slugify(alt) || 'image',
      alt,
      width: toDimension(tag.attrs.width),
      height: toDimension(tag.attrs.height),
      source: src,
      heading,
    });
  }
  return images;
}

/**
 * Return `markdown` with the `src` of each listed image replaced by its local
 * `/mocks/NN-slug.png` path. Every other character is left alone; with no
 * images the input is returned unchanged.
 */
export function rewriteImageSources(markdown, images) {
  if (!images || images.length === 0) return markdown;
  const bySource = new Map();
  for (const img of images) if (!bySource.has(img.source)) bySource.set(img.source, img);

  let out = '';
  let last = 0;
  for (const tag of scanImgTags(markdown)) {
    const src = tag.attrs.src;
    const img = src && bySource.get(src.value);
    if (!img) continue;
    out += markdown.slice(last, src.start) + imagePublicPath(img);
    last = src.end;
  }
  return out + markdown.slice(last);
}

/** True when the buffer starts with the 8 PNG signature bytes. */
export function isPng(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  if (!bytes || typeof bytes.length !== 'number' || bytes.length < PNG_MAGIC.length) return false;
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Pick the gist file to snapshot from the file names in its tree: the named
 * file, else the only file, else the first markdown file, else the first file.
 * Returns the name, or null.
 */
export function pickGistFile(names, filename) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string' && n.length > 0);
  if (filename) return list.find((n) => n === filename) ?? null;
  if (list.length === 1) return list[0];
  return list.find((n) => /\.(md|markdown)$/i.test(n)) ?? list[0] ?? null;
}

/** `https://gist.github.com/<owner>/<id>` (no owner: `https://gist.github.com/<id>`). */
export function gistHtmlUrl(owner, id) {
  return owner ? `https://gist.github.com/${owner}/${id}` : `https://gist.github.com/${id}`;
}

/** `https://gist.githubusercontent.com/<owner>/<id>/raw/<blob sha>/<file>` — the same URL the API reports. */
export function gistRawUrl(owner, id, blobSha, filename) {
  const base = owner ? `https://gist.githubusercontent.com/${owner}/${id}` : `https://gist.githubusercontent.com/${id}`;
  return blobSha ? `${base}/raw/${blobSha}/${filename}` : `${base}/raw/${filename}`;
}

/**
 * The `content/gist/meta.json` object — pure, given what the git clone knows
 * (`filename`, `revision` = HEAD sha, `updated_at` = HEAD committer date,
 * `blob_sha` of the file at HEAD) plus `owner`/`description`, which git does
 * not record and the caller carries over from the previous meta.json or flags.
 */
export function buildMeta(gist, images, fetchedAt) {
  const id = gist?.id ?? null;
  const owner = gist?.owner ?? null;
  const filename = gist?.filename ?? null;
  return {
    id,
    description: gist?.description ?? null,
    owner,
    html_url: id ? gistHtmlUrl(owner, id) : null,
    raw_url: id && filename ? gistRawUrl(owner, id, gist?.blob_sha ?? null, filename) : null,
    filename,
    revision: gist?.revision ?? null,
    updated_at: gist?.updated_at ?? null,
    fetched_at: fetchedAt instanceof Date ? fetchedAt.toISOString() : fetchedAt,
    images: (images ?? []).map(({ n, slug, alt, width, height, source }) => ({
      n,
      slug,
      file: imagePublicPath({ n, slug }),
      alt,
      width,
      height,
      source,
    })),
  };
}
