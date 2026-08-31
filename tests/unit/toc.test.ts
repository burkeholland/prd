import { describe, expect, it } from 'vitest';
import { buildToc, type Heading } from '../../src/lib/toc';

const h = (depth: number, slug: string, text = slug): Heading => ({ depth, slug, text });

describe('buildToc', () => {
  it('returns an empty list for no headings', () => {
    expect(buildToc([])).toEqual([]);
  });

  it('keeps only-h2 headings flat and in order', () => {
    const toc = buildToc([h(2, 'why'), h(2, 'stack'), h(2, 'routes')]);
    expect(toc).toHaveLength(3);
    expect(toc.map((item) => item.slug)).toEqual(['why', 'stack', 'routes']);
    expect(toc.every((item) => item.children.length === 0)).toBe(true);
    expect(toc.every((item) => item.synthetic === undefined)).toBe(true);
  });

  it('nests h3 headings under the preceding h2', () => {
    const toc = buildToc([
      h(2, 'stack'),
      h(3, 'frontend'),
      h(3, 'backend'),
      h(2, 'routes'),
      h(3, 'home'),
    ]);
    expect(toc.map((item) => item.slug)).toEqual(['stack', 'routes']);
    expect(toc[0]?.children.map((child) => child.slug)).toEqual(['frontend', 'backend']);
    expect(toc[1]?.children.map((child) => child.slug)).toEqual(['home']);
    expect(toc[0]?.children[0]).toEqual({
      depth: 3,
      slug: 'frontend',
      text: 'frontend',
      children: [],
    });
  });

  it('attaches an h3 that appears before any h2 to a synthetic root', () => {
    const toc = buildToc([h(3, 'orphan'), h(3, 'second-orphan'), h(2, 'first-real')]);
    expect(toc).toHaveLength(2);
    expect(toc[0]).toMatchObject({ synthetic: true, slug: '', text: '' });
    expect(toc[0]?.children.map((child) => child.slug)).toEqual(['orphan', 'second-orphan']);
    expect(toc[1]).toMatchObject({ slug: 'first-real', children: [] });
  });

  it('ignores h1 and headings of depth 4 or deeper', () => {
    const toc = buildToc([
      h(1, 'title'),
      h(2, 'section'),
      h(4, 'too-deep'),
      h(3, 'sub'),
      h(5, 'deeper'),
      h(6, 'deepest'),
    ]);
    expect(toc).toHaveLength(1);
    expect(toc[0]?.slug).toBe('section');
    expect(toc[0]?.children.map((child) => child.slug)).toEqual(['sub']);
  });

  it('does not create a synthetic root when the only headings are ignored', () => {
    expect(buildToc([h(1, 'title'), h(4, 'deep')])).toEqual([]);
  });
});
