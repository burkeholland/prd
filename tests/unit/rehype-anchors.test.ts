import { describe, expect, it } from 'vitest';
import rehypeAnchors, { anchorHeadings, hasLink } from '../../src/lib/rehype-anchors.mjs';

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const el = (tagName: string, children: Node[] = [], properties: Record<string, unknown> = {}): Node => ({
  type: 'element',
  tagName,
  properties,
  children,
});
const text = (value: string): Node => ({ type: 'text', value });
const heading = (tagName: string, label: string, id?: string) =>
  el(tagName, [text(label)], id === undefined ? {} : { id });
const root = (...children: Node[]): Node => ({ type: 'root', children });

const textOf = (node: Node): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('');

/** The one `a.heading-link` child a wrapped heading must have. */
function linkOf(node: Node): Node {
  expect(node.children, `${node.tagName} children`).toHaveLength(1);
  const [link] = node.children ?? [];
  expect(link.type).toBe('element');
  expect(link.tagName).toBe('a');
  expect(link.properties).toEqual({ className: ['heading-link'], href: `#${String(node.properties?.id)}` });
  return link;
}

describe('hasLink', () => {
  it('is false for a heading with only text', () => {
    expect(hasLink(heading('h2', 'Routes', 'routes'))).toBe(false);
  });

  it('is false for a heading with inline code', () => {
    expect(hasLink(el('h3', [text('Create '), el('code', [text('TECHNICAL_SPEC.md')])], { id: 'x' }))).toBe(false);
  });

  it('is true for a direct child link', () => {
    expect(hasLink(el('h2', [el('a', [text('Gist')], { href: 'https://gist.github.com' })], { id: 'gist' }))).toBe(true);
  });

  it('is true for a link nested deeper', () => {
    expect(hasLink(el('h2', [el('em', [el('a', [text('deep')], { href: '#' })])], { id: 'deep' }))).toBe(true);
  });

  it('is true for the link element itself', () => {
    expect(hasLink(el('a', [], { href: '#' }))).toBe(true);
  });
});

describe('anchorHeadings', () => {
  it('wraps h2, h3 and h4 with an id in one a.heading-link to #id', () => {
    const tree = root(heading('h2', 'Routes', 'routes'), heading('h3', 'Home', 'home'), heading('h4', 'Mocks', 'mocks'));
    const out = anchorHeadings(tree);
    expect(out).toBe(tree);

    for (const [node, label] of [
      [tree.children![0], 'Routes'],
      [tree.children![1], 'Home'],
      [tree.children![2], 'Mocks'],
    ] as const) {
      const link = linkOf(node);
      expect(link.children).toEqual([text(label)]);
    }
  });

  it('keeps the original children inside the link, in order', () => {
    const children = [text('Create '), el('code', [text('TECHNICAL_SPEC.md')]), text(' first')];
    const node = el('h2', [...children], { id: 'create-technical_spec-md-first' });
    anchorHeadings(root(node));

    const link = linkOf(node);
    expect(link.children).toEqual(children);
    expect(link.children![0]).toBe(children[0]);
    expect(link.children![1]).toBe(children[1]);
  });

  it('leaves h1 alone', () => {
    const node = heading('h1', 'Build The Urlist', 'build-the-urlist');
    anchorHeadings(root(node));
    expect(node.children).toEqual([text('Build The Urlist')]);
  });

  it('leaves h5 and h6 alone', () => {
    const h5 = heading('h5', 'Five', 'five');
    const h6 = heading('h6', 'Six', 'six');
    anchorHeadings(root(h5, h6));
    expect(h5.children).toEqual([text('Five')]);
    expect(h6.children).toEqual([text('Six')]);
  });

  it('leaves a heading without an id alone', () => {
    const missing = heading('h2', 'No id');
    const empty = heading('h2', 'Empty id', '');
    const notString = el('h3', [text('Odd id')], { id: 3 });
    anchorHeadings(root(missing, empty, notString));
    expect(missing.children).toEqual([text('No id')]);
    expect(empty.children).toEqual([text('Empty id')]);
    expect(notString.children).toEqual([text('Odd id')]);
  });

  it('leaves a heading that already contains a link alone', () => {
    const inner = el('a', [text('the gist')], { href: 'https://gist.github.com/x' });
    const node = el('h2', [text('See '), inner], { id: 'see-the-gist' });
    anchorHeadings(root(node));
    expect(node.children).toEqual([text('See '), inner]);
  });

  it('wraps a heading with an inline code child', () => {
    const node = el('h3', [text('The '), el('code', [text('/lists')]), text(' route')], { id: 'the-lists-route' });
    anchorHeadings(root(node));
    const link = linkOf(node);
    expect(link.children).toHaveLength(3);
    expect(link.children![1]).toEqual(el('code', [text('/lists')]));
  });

  it('keeps the text content of every wrapped heading identical', () => {
    const nodes = [
      heading('h2', 'Routes', 'routes'),
      el('h3', [text('Create '), el('code', [text('TECHNICAL_SPEC.md')]), text('.')], { id: 'create' }),
      el('h4', [el('em', [text('Home')]), text(' Page')], { id: 'home-page' }),
    ];
    const before = nodes.map(textOf);
    anchorHeadings(root(...nodes));
    expect(nodes.map(textOf)).toEqual(before);
    for (const node of nodes) linkOf(node);
  });

  it('finds headings nested below the root', () => {
    const quoted = heading('h3', 'Quoted', 'quoted');
    const listed = heading('h4', 'Listed', 'listed');
    anchorHeadings(root(el('blockquote', [quoted]), el('ul', [el('li', [listed])])));
    expect(linkOf(quoted).children).toEqual([text('Quoted')]);
    expect(linkOf(listed).children).toEqual([text('Listed')]);
  });

  it('does not touch non-heading elements or text nodes', () => {
    const p = el('p', [text('A '), el('a', [text('link')], { href: '#routes' })]);
    const tree = root(p, text('\n'), el('pre', [el('code', [text('x')])], { id: 'code-with-id' }));
    const snapshot = JSON.parse(JSON.stringify(tree));
    anchorHeadings(tree);
    expect(tree).toEqual(snapshot);
  });

  it('is idempotent: running twice wraps once', () => {
    const node = heading('h2', 'Routes', 'routes');
    const tree = root(node);
    anchorHeadings(tree);
    const once = JSON.parse(JSON.stringify(tree));
    anchorHeadings(tree);
    expect(tree).toEqual(once);
    const link = linkOf(node);
    expect(link.children).toEqual([text('Routes')]);
  });
});

describe('rehypeAnchors (default export)', () => {
  it('returns a transformer that wraps the headings of the tree in place', () => {
    const transform = rehypeAnchors() as (tree: Node) => void;
    const node = heading('h2', 'Definition of done', 'definition-of-done');
    const tree = root(heading('h1', 'Title', 'title'), node);
    transform(tree);
    expect(tree.children![0].children).toEqual([text('Title')]);
    const link = linkOf(node);
    expect(link.properties?.href).toBe('#definition-of-done');
  });
});
