// @ts-check
/**
 * Rehype plugin that makes every section heading in rendered markdown a link
 * to itself, so a reader can copy a link to one part of a page:
 *
 *   <h2 id="routes">Routes</h2>
 *
 * becomes
 *
 *   <h2 id="routes"><a class="heading-link" href="#routes">Routes</a></h2>
 *
 * The heading's own children move inside the link; nothing is added, so the
 * heading's `textContent` and accessible name are exactly what they were (the
 * template page names its copy buttons from the nearest h2's text, and the
 * ToC and tests read heading text too). The `#` a reader sees on hover is CSS
 * (`.prose :is(h2, h3, h4) > a.heading-link::after` in global.css) and is kept
 * out of the accessible name and out of print.
 *
 * Only `h2`–`h4` with a non-empty `id` are wrapped: `h1` is the document title,
 * and the ids come from Astro's `rehypeHeadingIds`, which therefore has to run
 * before this plugin (astro.config.mjs lists it explicitly; Astro's own later
 * run keeps the ids it finds). A heading that already contains a link is left
 * alone — a link inside a link is invalid HTML — which also makes the plugin
 * idempotent: a wrapped heading contains a link.
 *
 * @typedef {{
 *   type: string,
 *   tagName?: string,
 *   value?: string,
 *   properties?: Record<string, unknown>,
 *   children?: HastNode[],
 * }} HastNode
 */

const ANCHOR_TAGS = new Set(['h2', 'h3', 'h4']);

/**
 * True when the node or any of its descendants is an `a` element.
 * @param {HastNode} node
 * @returns {boolean}
 */
export function hasLink(node) {
  if (node.type === 'element' && node.tagName === 'a') return true;
  return (node.children ?? []).some(hasLink);
}

/**
 * The non-empty string `id` of a heading element that should get a permalink,
 * or undefined.
 * @param {HastNode} node
 * @returns {string | undefined}
 */
function anchorIdOf(node) {
  if (node.type !== 'element' || !node.tagName || !ANCHOR_TAGS.has(node.tagName)) return undefined;
  const id = node.properties?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * Wraps the children of every `h2`–`h4` that has an id and contains no link in
 * `<a class="heading-link" href="#id">`. Mutates and returns `tree`. Exported for tests.
 * @template {HastNode} T
 * @param {T} tree
 * @returns {T}
 */
export function anchorHeadings(tree) {
  const id = anchorIdOf(tree);
  if (id !== undefined) {
    if (!hasLink(tree)) {
      tree.children = [
        {
          type: 'element',
          tagName: 'a',
          properties: { className: ['heading-link'], href: `#${id}` },
          children: tree.children ?? [],
        },
      ];
    }
    return tree;
  }
  for (const child of tree.children ?? []) anchorHeadings(child);
  return tree;
}

export default function rehypeAnchors() {
  return (/** @type {HastNode} */ tree) => {
    anchorHeadings(tree);
  };
}
