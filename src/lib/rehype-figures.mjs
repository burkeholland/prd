// @ts-check
/**
 * Rehype plugin that turns each block-level image in rendered markdown into a
 * captioned, lazily loaded figure:
 *
 *   #### Home Page
 *   <img alt="Screenshot 2026-08-31 080518" src="/mocks/01-home-page.png" />
 *
 * becomes
 *
 *   <h4>Home Page</h4>
 *   <figure class="figure">
 *     <img alt="Home Page" src="/mocks/01-home-page.png" loading="lazy" decoding="async" />
 *     <figcaption>Home Page</figcaption>
 *   </figure>
 *
 * The caption is the text of the nearest preceding `h4`; a higher heading
 * (h1–h3) starts a new section and clears it, so an image with no h4 of its own
 * gets a figure without a caption. When there is a caption and the image's own
 * alt is a placeholder — missing, blank, the file name, or an auto-generated
 * "Screenshot 2026-08-31 080518" — the caption becomes the alt, so a screen
 * reader hears what the screenshot shows; a written alt is never replaced.
 * Only top-level images are wrapped: a raw
 * `<img>` HTML block (the gist's screenshots) or a paragraph whose only content
 * is an `<img>` (markdown `![alt](src)` syntax). Inline images inside text and
 * every other node are left alone, so the document text does not change.
 *
 * Astro runs user rehype plugins before rehype-raw, so the gist's `<img>` tags
 * are still `raw` string nodes here; they are edited as strings and become
 * elements when rehype-raw parses the tree.
 *
 * @typedef {{
 *   type: string,
 *   tagName?: string,
 *   value?: string,
 *   properties?: Record<string, unknown>,
 *   children?: HastNode[],
 * }} HastNode
 */

/** A raw HTML block that is exactly one `<img …>` tag (surrounding whitespace allowed). */
const RAW_IMG_BLOCK = /^\s*<img\b[^>]*>\s*$/i;
const CAPTION_TAGS = new Set(['h4']);
const SECTION_TAGS = new Set(['h1', 'h2', 'h3']);
/** `alt="…"` / `alt='…'` / bare `alt` on a raw `<img>` tag. */
const RAW_ALT = /\salt(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/i;
const RAW_SRC = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i;
/** Auto-generated screenshot names such as GitHub's "Screenshot 2026-08-31 080518". */
const SCREENSHOT_NAME = /^screen ?shot\b[\s\d:._-]*(?:at[\s\d:._-]*)?(?:[ap]m)?$/i;

/**
 * True when an image's alt text says nothing a caption would not say better:
 * missing, blank, the file name (with or without its extension), or an
 * auto-generated screenshot name. A written alt is never touched.
 * @param {string | undefined} alt
 * @param {string | undefined} src
 * @returns {boolean}
 */
export function isPlaceholderAlt(alt, src) {
  const text = (alt ?? '').trim();
  if (!text) return true;
  if (IMAGE_EXTENSION.test(text) || SCREENSHOT_NAME.test(text)) return true;
  const file = (src ?? '').split(/[?#]/)[0].split('/').pop() ?? '';
  const stem = file.replace(IMAGE_EXTENSION, '');
  const lower = text.toLowerCase();
  return file !== '' && (lower === file.toLowerCase() || lower === stem.toLowerCase());
}

/**
 * Concatenates the text of a node's descendants.
 * @param {HastNode} node
 * @returns {string}
 */
export function textOf(node) {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/**
 * Adds `loading="lazy"` and `decoding="async"` to a raw `<img …>` tag string,
 * keeping any values the tag already carries.
 * @param {string} tag
 * @returns {string}
 */
export function lazyImgTag(tag) {
  let out = tag;
  const missing = ['loading="lazy"', 'decoding="async"'].filter(
    (attr) => !new RegExp(`\\s${attr.split('=')[0]}=`, 'i').test(out),
  );
  if (missing.length === 0) return out;
  // Insert before the closing `/>` or `>`.
  out = out.replace(/\s*\/?>\s*$/, (end) => ` ${missing.join(' ')}${end.trimStart() === '/>' ? ' />' : '>'}`);
  return out;
}

/**
 * Gives a raw `<img …>` tag string the caption as `alt` when its own alt is a
 * placeholder (see `isPlaceholderAlt`); a written alt is kept as is.
 * @param {string} tag
 * @param {string | undefined} caption
 * @returns {string}
 */
export function captionAltTag(tag, caption) {
  if (!caption) return tag;
  const alt = RAW_ALT.exec(tag);
  const src = RAW_SRC.exec(tag);
  const current = alt ? (alt[1] ?? alt[2] ?? alt[3] ?? '') : undefined;
  if (!isPlaceholderAlt(current, src?.[1] ?? src?.[2] ?? src?.[3])) return tag;
  const attr = ` alt="${caption.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  if (alt) return tag.replace(RAW_ALT, attr);
  return tag.replace(/^<img\b/i, `<img${attr}`);
}

/**
 * @param {HastNode} node
 * @returns {boolean}
 */
function isElementImg(node) {
  return node.type === 'element' && node.tagName === 'img';
}

/**
 * Returns the image node of a paragraph that contains nothing but one `<img>`
 * (whitespace allowed), or undefined.
 * @param {HastNode} node
 * @returns {HastNode | undefined}
 */
function soleImageOf(node) {
  if (node.type !== 'element' || node.tagName !== 'p') return undefined;
  const meaningful = (node.children ?? []).filter(
    (child) => !(child.type === 'text' && (child.value ?? '').trim() === ''),
  );
  return meaningful.length === 1 && isElementImg(meaningful[0]) ? meaningful[0] : undefined;
}

/**
 * Builds the `<figure>` wrapper around an image node.
 * @param {HastNode} image raw `<img>` string node or `img` element
 * @param {string | undefined} caption
 * @returns {HastNode}
 */
function figureFor(image, caption) {
  /** @type {HastNode[]} */
  const children = [image];
  if (caption) {
    children.push({
      type: 'element',
      tagName: 'figcaption',
      properties: {},
      children: [{ type: 'text', value: caption }],
    });
  }
  return { type: 'element', tagName: 'figure', properties: { className: ['figure'] }, children };
}

/**
 * Rewrites the top-level children of `tree` in place. Exported for tests.
 * @param {HastNode} tree
 * @returns {number} number of figures created
 */
export function wrapFigures(tree) {
  const children = tree.children ?? [];
  /** @type {string | undefined} */
  let caption;
  let count = 0;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    if (node.type === 'element' && node.tagName) {
      if (CAPTION_TAGS.has(node.tagName)) {
        caption = textOf(node).trim() || undefined;
        continue;
      }
      if (SECTION_TAGS.has(node.tagName)) {
        caption = undefined;
        continue;
      }
    }

    if (node.type === 'raw' && typeof node.value === 'string' && RAW_IMG_BLOCK.test(node.value)) {
      children[i] = figureFor({ type: 'raw', value: captionAltTag(lazyImgTag(node.value.trim()), caption) }, caption);
      count++;
      continue;
    }

    const image = soleImageOf(node);
    if (image) {
      image.properties = { loading: 'lazy', decoding: 'async', ...image.properties };
      const { alt, src } = image.properties;
      if (caption && isPlaceholderAlt(typeof alt === 'string' ? alt : undefined, typeof src === 'string' ? src : undefined)) {
        image.properties.alt = caption;
      }
      children[i] = figureFor(image, caption);
      count++;
    }
  }

  return count;
}

export default function rehypeFigures() {
  return (/** @type {HastNode} */ tree) => {
    wrapFigures(tree);
  };
}
