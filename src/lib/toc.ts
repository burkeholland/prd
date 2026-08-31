/** Shape of the `headings` array Astro returns from `render()`. */
export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

export interface TocItem {
  depth: 2 | 3;
  slug: string;
  text: string;
  children: TocItem[];
  /** Placeholder parent created when an h3 appears before any h2. It has no slug or text. */
  synthetic?: true;
}

/**
 * Turns a flat heading list into a two-level table of contents:
 * h2 entries with their following h3s as children. h1 and h4+ are ignored.
 * An h3 that appears before any h2 is attached to a synthetic root item.
 */
export function buildToc(headings: readonly Heading[]): TocItem[] {
  const toc: TocItem[] = [];
  let current: TocItem | undefined;

  for (const heading of headings) {
    if (heading.depth === 2) {
      current = { depth: 2, slug: heading.slug, text: heading.text, children: [] };
      toc.push(current);
    } else if (heading.depth === 3) {
      if (!current) {
        current = { depth: 2, slug: '', text: '', children: [], synthetic: true };
        toc.push(current);
      }
      current.children.push({ depth: 3, slug: heading.slug, text: heading.text, children: [] });
    }
  }

  return toc;
}
