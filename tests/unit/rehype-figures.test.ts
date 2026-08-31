import { describe, expect, it } from 'vitest';
import rehypeFigures, { lazyImgTag, textOf, wrapFigures } from '../../src/lib/rehype-figures.mjs';

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
const raw = (value: string): Node => ({ type: 'raw', value });
const heading = (tagName: string, label: string) => el(tagName, [text(label)]);

const IMG_1 = '<img width="1452" height="1580" alt="Screenshot 2026-08-31 080518" src="/prd/mocks/01-home-page.png" />';
const IMG_2 = '<img width="1452" height="1580" alt="Screenshot 2026-08-31 080549" src="/prd/mocks/02-new-list.png" />';

/** The shape of the gist's "Mocks" section after remark-rehype, before rehype-raw. */
const gistLike = (): Node => ({
  type: 'root',
  children: [
    heading('h1', 'Build The Urlist'),
    text('\n'),
    heading('h2', 'Mocks'),
    text('\n'),
    heading('h4', 'Home Page'),
    text('\n'),
    raw(IMG_1),
    text('\n'),
    heading('h4', 'New List'),
    text('\n'),
    raw(IMG_2),
    text('\n'),
    heading('h2', 'Technical specification and checklist'),
    text('\n'),
    el('p', [text('Before coding, create '), el('code', [text('TECHNICAL_SPEC.md')]), text('.')]),
  ],
});

describe('lazyImgTag', () => {
  it('adds loading="lazy" and decoding="async" before a self-closing end', () => {
    expect(lazyImgTag('<img alt="a" src="/x.png" />')).toBe(
      '<img alt="a" src="/x.png" loading="lazy" decoding="async" />',
    );
  });

  it('adds them before a plain ">" too', () => {
    expect(lazyImgTag('<img src="/x.png">')).toBe('<img src="/x.png" loading="lazy" decoding="async">');
  });

  it('keeps values the tag already carries', () => {
    expect(lazyImgTag('<img src="/x.png" loading="eager">')).toBe('<img src="/x.png" loading="eager" decoding="async">');
    expect(lazyImgTag('<img decoding="sync" loading="lazy" src="/x.png" />')).toBe(
      '<img decoding="sync" loading="lazy" src="/x.png" />',
    );
  });
});

describe('textOf', () => {
  it('concatenates nested text', () => {
    expect(textOf(el('h4', [text('New List: '), el('em', [text('Validation')]), text(' States')]))).toBe(
      'New List: Validation States',
    );
  });
});

describe('wrapFigures', () => {
  it('wraps each raw <img> block in a figure captioned from the nearest preceding h4', () => {
    const tree = gistLike();
    expect(wrapFigures(tree)).toBe(2);

    const figures = (tree.children ?? []).filter((node) => node.tagName === 'figure');
    expect(figures).toHaveLength(2);

    const [first, second] = figures;
    expect(first.properties).toEqual({ className: ['figure'] });
    expect(first.children?.map((child) => child.type)).toEqual(['raw', 'element']);
    expect(first.children?.[0].value).toBe(
      '<img width="1452" height="1580" alt="Screenshot 2026-08-31 080518" src="/prd/mocks/01-home-page.png" loading="lazy" decoding="async" />',
    );
    expect(first.children?.[1]).toEqual(el('figcaption', [text('Home Page')]));
    expect(second.children?.[1]).toEqual(el('figcaption', [text('New List')]));
  });

  it('leaves headings, paragraphs and text untouched (the gist text does not change)', () => {
    const tree = gistLike();
    const before = JSON.stringify((tree.children ?? []).filter((node) => node.type !== 'raw'));
    wrapFigures(tree);
    const after = JSON.stringify((tree.children ?? []).filter((node) => node.tagName !== 'figure'));
    expect(after).toBe(before);
    expect(tree.children?.filter((node) => node.tagName === 'h4')).toHaveLength(2);
  });

  it('clears the caption when a higher heading starts a new section', () => {
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Old caption'), heading('h2', 'Next section'), raw('<img src="/a.png">')],
    };
    wrapFigures(tree);
    const figure = tree.children?.[2];
    expect(figure?.tagName).toBe('figure');
    expect(figure?.children).toEqual([raw('<img src="/a.png" loading="lazy" decoding="async">')]);
  });

  it('wraps a paragraph that holds only a markdown image and keeps existing attributes', () => {
    const img = el('img', [], { src: '/b.png', alt: 'b', loading: 'eager' });
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'B'), el('p', [text('\n'), img, text(' ')])],
    };
    wrapFigures(tree);
    const figure = tree.children?.[1];
    expect(figure?.tagName).toBe('figure');
    expect(figure?.children?.[0]).toBe(img);
    expect(img.properties).toEqual({ src: '/b.png', alt: 'b', loading: 'eager', decoding: 'async' });
    expect(figure?.children?.[1]).toEqual(el('figcaption', [text('B')]));
  });

  it('ignores inline images, images in list items and raw HTML that is not a lone <img>', () => {
    const tree: Node = {
      type: 'root',
      children: [
        el('p', [text('See '), el('img', [], { src: '/c.png' }), text(' here.')]),
        el('ul', [el('li', [el('img', [], { src: '/d.png' })])]),
        raw('<div><img src="/e.png"></div>'),
        raw('<img src="/f.png"><img src="/g.png">'),
      ],
    };
    const before = JSON.stringify(tree);
    expect(wrapFigures(tree)).toBe(0);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('is exposed as a rehype plugin', () => {
    const tree = gistLike();
    rehypeFigures()(tree);
    expect(tree.children?.filter((node) => node.tagName === 'figure')).toHaveLength(2);
  });
});
