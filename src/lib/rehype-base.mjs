// @ts-check
/**
 * Rehype plugin that makes root-relative URLs in rendered markdown base-path aware.
 *
 * With `{ base: '/prd' }`:
 *   /mocks/01-home-page.png → /prd/mocks/01-home-page.png
 *   /sample                 → /prd/sample/      (page path: trailing slash added)
 *   /sample#how             → /prd/sample/#how  (fragment / query kept)
 * Untouched: `//host/x`, `https://…`, `#anchor`, `./x`, `x`, `mailto:…`, and
 * values already under the base. With a base of '' or '/' the plugin is a no-op.
 *
 * Only `a[href]`, `img[src]`, `source[src]`, `video[src]` and `link[href]` are
 * rewritten. Raw HTML in markdown (the gist's `<img … src="/mocks/…">` tags) is
 * still a `raw` string node when user rehype plugins run — Astro applies
 * rehype-raw last — so those tags are rewritten with a small regex over the same
 * element/attribute pairs.
 *
 * @typedef {{
 *   type: string,
 *   tagName?: string,
 *   value?: string,
 *   properties?: Record<string, unknown>,
 *   children?: HastNode[],
 * }} HastNode
 */

/** Attribute rewritten per element; anything else is left alone. */
const TARGETS = /** @type {Record<string, string | undefined>} */ ({
  a: 'href',
  img: 'src',
  source: 'src',
  video: 'src',
  link: 'href',
});

const RAW_TAG = /<(a|img|source|video|link)\b[^>]*>/gi;

/**
 * Normalizes the configured base to '' (no prefix) or '/prefix' with no trailing slash.
 * @param {string | undefined} base
 * @returns {string}
 */
export function normalizeBase(base) {
  const trimmed = (base ?? '').replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Rewrites one URL. Returns it unchanged unless it is root-relative (exactly one
 * leading slash) and not already under the base.
 * @param {string} value
 * @param {string} base normalized base, e.g. '/prd' ('' disables rewriting)
 * @returns {string}
 */
export function rebase(value, base) {
  if (base === '' || !value.startsWith('/') || value.startsWith('//')) return value;
  if (value.startsWith(base)) {
    const next = value.charAt(base.length);
    if (next === '' || next === '/' || next === '?' || next === '#') return value;
  }

  const cut = value.search(/[?#]/);
  let path = cut === -1 ? value : value.slice(0, cut);
  const suffix = cut === -1 ? '' : value.slice(cut);

  // A last segment without a "." is a page, not a file: give it the trailing slash
  // GitHub Pages serves directly (no 301 to the slash form).
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (last !== '' && !last.includes('.')) path += '/';

  return base + path + suffix;
}

/**
 * Rewrites the target attribute inside raw HTML tags.
 * @param {string} html
 * @param {string} base
 * @returns {string}
 */
function rebaseRaw(html, base) {
  return html.replace(RAW_TAG, (tag, /** @type {string} */ name) => {
    const attr = TARGETS[name.toLowerCase()];
    if (!attr) return tag;
    const pattern = new RegExp(`(\\s${attr}=)(["']?)([^\\s"'>]*)\\2`, 'i');
    return tag.replace(
      pattern,
      (_match, /** @type {string} */ lead, /** @type {string} */ quote, /** @type {string} */ url) =>
        `${lead}${quote}${rebase(url, base)}${quote}`,
    );
  });
}

/**
 * @param {HastNode} node
 * @param {string} base
 */
function walk(node, base) {
  if (node.type === 'element' && node.tagName && node.properties) {
    const attr = TARGETS[node.tagName];
    const value = attr ? node.properties[attr] : undefined;
    if (attr && typeof value === 'string') node.properties[attr] = rebase(value, base);
  } else if (node.type === 'raw' && typeof node.value === 'string') {
    node.value = rebaseRaw(node.value, base);
  }
  if (node.children) {
    for (const child of node.children) walk(child, base);
  }
}

/**
 * @param {{ base?: string }} [options]
 */
export default function rehypeBase(options = {}) {
  const base = normalizeBase(options.base);
  if (base === '') return () => {};
  return (/** @type {HastNode} */ tree) => {
    walk(tree, base);
  };
}
