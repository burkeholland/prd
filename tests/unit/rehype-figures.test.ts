import { describe, expect, it } from 'vitest';
import rehypeFigures, {
  captionAltTag,
  isPlaceholderAlt,
  lazyImgTag,
  textOf,
  wrapFigures,
} from '../../src/lib/rehype-figures.mjs';

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

describe('isPlaceholderAlt', () => {
  it('treats missing, blank, file-name and screenshot-timestamp alts as placeholders', () => {
    expect(isPlaceholderAlt(undefined, '/prd/mocks/01-home-page.png')).toBe(true);
    expect(isPlaceholderAlt('   ', '/prd/mocks/01-home-page.png')).toBe(true);
    expect(isPlaceholderAlt('01-home-page.png', '/prd/mocks/01-home-page.png')).toBe(true);
    expect(isPlaceholderAlt('01-Home-Page', '/prd/mocks/01-home-page.png?v=2')).toBe(true);
    expect(isPlaceholderAlt('anything.PNG', '/x.png')).toBe(true);
    expect(isPlaceholderAlt('Screenshot 2026-08-31 080518', '/prd/mocks/01-home-page.png')).toBe(true);
    expect(isPlaceholderAlt('Screenshot 2026-08-31 at 08.05.18', '/a.png')).toBe(true);
    expect(isPlaceholderAlt('Screen Shot 2026-08-31 at 8.05.18 AM', '/a.png')).toBe(true);
  });

  it('keeps a written alt', () => {
    expect(isPlaceholderAlt('Home page with an empty list and a New list button', '/a.png')).toBe(false);
    expect(isPlaceholderAlt('Screenshot of the login modal', '/a.png')).toBe(false);
    expect(isPlaceholderAlt('b', undefined)).toBe(false);
  });
});

describe('captionAltTag', () => {
  it('replaces a placeholder alt with the caption and escapes it', () => {
    expect(captionAltTag('<img alt="Screenshot 2026-08-31 080518" src="/a.png" />', 'Home Page')).toBe(
      '<img alt="Home Page" src="/a.png" />',
    );
    expect(captionAltTag("<img src='/a.png' alt='a.png'>", 'Say "hi" & <go>')).toBe(
      '<img src=\'/a.png\' alt="Say &quot;hi&quot; &amp; &lt;go>">',
    );
  });

  it('adds an alt when the tag has none', () => {
    expect(captionAltTag('<img src="/a.png">', 'New List')).toBe('<img alt="New List" src="/a.png">');
    expect(captionAltTag('<img alt src="/a.png">', 'New List')).toBe('<img alt="New List" src="/a.png">');
  });

  it('keeps a written alt and does nothing without a caption', () => {
    const written = '<img alt="The home page, empty" src="/a.png" />';
    expect(captionAltTag(written, 'Home Page')).toBe(written);
    expect(captionAltTag('<img alt="a.png" src="/a.png" />', undefined)).toBe('<img alt="a.png" src="/a.png" />');
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
      '<img width="1452" height="1580" alt="Home Page" src="/prd/mocks/01-home-page.png" loading="lazy" decoding="async" />',
    );
    expect(first.children?.[1]).toEqual(el('figcaption', [text('Home Page')]));
    expect(second.children?.[0].value).toContain('alt="New List"');
    expect(second.children?.[1]).toEqual(el('figcaption', [text('New List')]));
  });

  it('keeps a written alt on a raw <img> block', () => {
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Home Page'), raw('<img alt="The empty home page" src="/a.png" />')],
    };
    wrapFigures(tree);
    expect(tree.children?.[1].children?.[0].value).toBe(
      '<img alt="The empty home page" src="/a.png" loading="lazy" decoding="async" />',
    );
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
    const img = el('img', [], { src: '/b.png', alt: 'Screen B, empty', loading: 'eager' });
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'B'), el('p', [text('\n'), img, text(' ')])],
    };
    wrapFigures(tree);
    const figure = tree.children?.[1];
    expect(figure?.tagName).toBe('figure');
    expect(figure?.children?.[0]).toBe(img);
    expect(img.properties).toEqual({ src: '/b.png', alt: 'Screen B, empty', loading: 'eager', decoding: 'async' });
    expect(figure?.children?.[1]).toEqual(el('figcaption', [text('B')]));
  });

  it('gives a markdown image with an empty or file-name alt the caption as alt', () => {
    const empty = el('img', [], { src: '/c.png', alt: '' });
    const fileName = el('img', [], { src: '/mocks/04-login-modal.png', alt: '04-login-modal' });
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Login Modal'), el('p', [empty]), el('p', [fileName])],
    };
    expect(wrapFigures(tree)).toBe(2);
    expect(empty.properties?.alt).toBe('Login Modal');
    expect(fileName.properties?.alt).toBe('Login Modal');
  });

  it('leaves a placeholder alt alone when there is no caption to use', () => {
    const tree: Node = {
      type: 'root',
      children: [raw('<img alt="Screenshot 2026-08-31 080518" src="/a.png">')],
    };
    wrapFigures(tree);
    expect(tree.children?.[0].children?.[0].value).toBe(
      '<img alt="Screenshot 2026-08-31 080518" src="/a.png" loading="lazy" decoding="async">',
    );
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
