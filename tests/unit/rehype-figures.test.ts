import { describe, expect, it } from 'vitest';
import rehypeFigures, {
  SIZES,
  captionAltTag,
  isPlaceholderAlt,
  lazyImgTag,
  pictureTag,
  publicFileExists,
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

// `exists` stubs: the derived WebP copies are generated at build time, so the tests never look at disk.
const none = { exists: () => false };
const all = { exists: () => true };

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

  it('with eager: loading="eager" fetchpriority="high" decoding="async", replacing an existing loading', () => {
    expect(lazyImgTag('<img alt="a" src="/x.png" />', { eager: true })).toBe(
      '<img alt="a" src="/x.png" loading="eager" fetchpriority="high" decoding="async" />',
    );
    expect(lazyImgTag('<img loading="lazy" src="/x.png">', { eager: true })).toBe(
      '<img src="/x.png" loading="eager" fetchpriority="high" decoding="async">',
    );
    expect(lazyImgTag("<img src='/x.png' loading='lazy' fetchpriority='low' decoding=\"sync\">", { eager: true })).toBe(
      '<img src=\'/x.png\' decoding="sync" loading="eager" fetchpriority="high">',
    );
    expect(lazyImgTag('<img src="/x.png">', { eager: false })).toBe('<img src="/x.png" loading="lazy" decoding="async">');
  });
});

describe('pictureTag', () => {
  const img = '<img alt="Home Page" src="/prd/mocks/01-home-page.png" loading="lazy" decoding="async" />';

  it('wraps a mock screenshot in <picture> with a WebP <source> when both derived copies exist', () => {
    const asked: string[] = [];
    const out = pictureTag(img, {
      exists: (file) => {
        asked.push(file);
        return true;
      },
    });
    expect(out).toBe(
      '<picture><source type="image/webp" srcset="/prd/mocks/derived/01-home-page-760.webp 760w, /prd/mocks/derived/01-home-page-1320.webp 1320w" ' +
        `sizes="${SIZES}">${img}</picture>`,
    );
    expect(asked).toEqual(['mocks/derived/01-home-page-760.webp', 'mocks/derived/01-home-page-1320.webp']);
    expect(SIZES).toMatch(/^\(min-width: \d+em\) \d+px, calc\(100vw - [\d.]+rem\)$/);
  });

  it('keeps the <img> byte-identical inside the wrapper', () => {
    const out = pictureTag(img, all);
    expect(out.startsWith('<picture><source ')).toBe(true);
    expect(out.endsWith(`>${img}</picture>`)).toBe(true);
    expect(out.match(/<img\b/g)).toHaveLength(1);
  });

  it('leaves the tag alone when either derived copy is missing', () => {
    expect(pictureTag(img, none)).toBe(img);
    expect(pictureTag(img, { exists: (file) => file.endsWith('-760.webp') })).toBe(img);
    expect(pictureTag(img, { exists: (file) => file.endsWith('-1320.webp') })).toBe(img);
  });

  it('leaves images that are not under /mocks/ alone, even when the copies would exist', () => {
    expect(pictureTag('<img src="/prd/og.png">', all)).toBe('<img src="/prd/og.png">');
    expect(pictureTag('<img src="/prd/mocks/derived/x-760.webp">', all)).toBe('<img src="/prd/mocks/derived/x-760.webp">');
    expect(pictureTag('<img src="/prd/mocks/x.jpg">', all)).toBe('<img src="/prd/mocks/x.jpg">');
    expect(pictureTag('<img alt="no src">', all)).toBe('<img alt="no src">');
  });

  it('preserves whatever prefix precedes /mocks/ (the base is never hard-coded)', () => {
    expect(pictureTag('<img src="/anything/mocks/x.png">', all)).toBe(
      '<picture><source type="image/webp" srcset="/anything/mocks/derived/x-760.webp 760w, /anything/mocks/derived/x-1320.webp 1320w" ' +
        `sizes="${SIZES}"><img src="/anything/mocks/x.png"></picture>`,
    );
    expect(pictureTag("<img src='/mocks/y.png'>", all)).toContain('srcset="/mocks/derived/y-760.webp 760w, /mocks/derived/y-1320.webp 1320w"');
    expect(pictureTag('<img src="https://example.test/prd/mocks/z.png">', all)).toContain(
      'srcset="https://example.test/prd/mocks/derived/z-760.webp 760w, https://example.test/prd/mocks/derived/z-1320.webp 1320w"',
    );
  });

  it('by default looks for the copies under public/ of the cwd', () => {
    expect(publicFileExists('mocks/derived/definitely-not-there-760.webp')).toBe(false);
    expect(publicFileExists('favicon.svg') || publicFileExists('prd-template.md') || publicFileExists('mocks')).toBe(true);
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
    expect(wrapFigures(tree, none)).toBe(2);

    const figures = (tree.children ?? []).filter((node) => node.tagName === 'figure');
    expect(figures).toHaveLength(2);

    const [first, second] = figures;
    expect(first.properties).toEqual({ className: ['figure'] });
    expect(first.children?.map((child) => child.type)).toEqual(['raw', 'element']);
    expect(first.children?.[0].value).toBe(
      '<img width="1452" height="1580" alt="Home Page" src="/prd/mocks/01-home-page.png" loading="eager" fetchpriority="high" decoding="async" />',
    );
    expect(first.children?.[1]).toEqual(el('figcaption', [text('Home Page')]));
    expect(second.children?.[0].value).toBe(
      '<img width="1452" height="1580" alt="New List" src="/prd/mocks/02-new-list.png" loading="lazy" decoding="async" />',
    );
    expect(second.children?.[1]).toEqual(el('figcaption', [text('New List')]));
  });

  it('loads the first raw image eagerly with fetchpriority="high" and every later one lazily', () => {
    const tree: Node = {
      type: 'root',
      children: [raw('<img src="/a.png">'), raw('<img src="/b.png" loading="lazy">'), el('p', [el('img', [], { src: '/c.png' })])],
    };
    expect(wrapFigures(tree, none)).toBe(3);
    expect(tree.children?.[0].children?.[0].value).toBe('<img src="/a.png" loading="eager" fetchpriority="high" decoding="async">');
    expect(tree.children?.[1].children?.[0].value).toBe('<img src="/b.png" loading="lazy" decoding="async">');
    expect(tree.children?.[2].children?.[0].properties).toEqual({ src: '/c.png', loading: 'lazy', decoding: 'async' });
  });

  it('does the same on the element path (hast fetchPriority → the fetchpriority attribute)', () => {
    const first = el('img', [], { src: '/a.png', alt: 'A', loading: 'lazy' });
    const second = el('img', [], { src: '/b.png', alt: 'B' });
    const tree: Node = { type: 'root', children: [el('p', [first]), el('p', [second])] };
    expect(wrapFigures(tree, none)).toBe(2);
    expect(first.properties).toEqual({ src: '/a.png', alt: 'A', decoding: 'async', loading: 'eager', fetchPriority: 'high' });
    expect(second.properties).toEqual({ src: '/b.png', alt: 'B', loading: 'lazy', decoding: 'async' });
    expect(second.properties).not.toHaveProperty('fetchPriority');
  });

  it('serves mock screenshots through <picture> on both paths: two figures → two <picture>, one fetchpriority', () => {
    const tree = gistLike();
    expect(wrapFigures(tree, all)).toBe(2);
    const html = (tree.children ?? [])
      .filter((node) => node.tagName === 'figure')
      .map((figure) => figure.children?.[0].value ?? '')
      .join('\n');
    expect(html.match(/<picture>/g)).toHaveLength(2);
    expect(html.match(/<\/picture>/g)).toHaveLength(2);
    expect(html.match(/<source type="image\/webp"/g)).toHaveLength(2);
    expect(html.match(/fetchpriority/g)).toHaveLength(1);
    expect(html.match(/loading="eager"/g)).toHaveLength(1);
    expect(html.match(/loading="lazy"/g)).toHaveLength(1);
    expect(html).toContain('srcset="/prd/mocks/derived/01-home-page-760.webp 760w, /prd/mocks/derived/01-home-page-1320.webp 1320w"');
    expect(html).toContain('srcset="/prd/mocks/derived/02-new-list-760.webp 760w, /prd/mocks/derived/02-new-list-1320.webp 1320w"');
    expect(html).toContain('<img width="1452" height="1580" alt="Home Page" src="/prd/mocks/01-home-page.png" loading="eager" fetchpriority="high" decoding="async" /></picture>');

    // Element path: <picture><source …><img …></picture>, the same img node inside.
    const img = el('img', [], { src: '/prd/mocks/03-new-list-validation-states.png', alt: '' });
    const elementTree: Node = { type: 'root', children: [heading('h4', 'Validation'), el('p', [img])] };
    expect(wrapFigures(elementTree, all)).toBe(1);
    const picture = elementTree.children?.[1].children?.[0];
    expect(picture?.tagName).toBe('picture');
    expect(picture?.children?.map((child) => child.tagName)).toEqual(['source', 'img']);
    expect(picture?.children?.[0].properties).toEqual({
      type: 'image/webp',
      srcSet:
        '/prd/mocks/derived/03-new-list-validation-states-760.webp 760w, /prd/mocks/derived/03-new-list-validation-states-1320.webp 1320w',
      sizes: SIZES,
    });
    expect(picture?.children?.[1]).toBe(img);
    expect(img.properties).toEqual({
      src: '/prd/mocks/03-new-list-validation-states.png',
      alt: 'Validation',
      decoding: 'async',
      loading: 'eager',
      fetchPriority: 'high',
    });
    expect(elementTree.children?.[1].children?.[1]).toEqual(el('figcaption', [text('Validation')]));

    // Without the derived copies the same trees get plain <img> figures.
    const bare = gistLike();
    wrapFigures(bare, none);
    expect(JSON.stringify(bare)).not.toContain('<picture>');
    const bareImg = el('img', [], { src: '/prd/mocks/03-new-list-validation-states.png' });
    const bareTree: Node = { type: 'root', children: [el('p', [bareImg])] };
    wrapFigures(bareTree, none);
    expect(bareTree.children?.[0].children?.[0]).toBe(bareImg);
  });

  it('keeps a written alt on a raw <img> block', () => {
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Home Page'), raw('<img alt="The empty home page" src="/a.png" />')],
    };
    wrapFigures(tree, none);
    expect(tree.children?.[1].children?.[0].value).toBe(
      '<img alt="The empty home page" src="/a.png" loading="eager" fetchpriority="high" decoding="async" />',
    );
  });

  it('leaves headings, paragraphs and text untouched (the gist text does not change)', () => {
    const tree = gistLike();
    const before = JSON.stringify((tree.children ?? []).filter((node) => node.type !== 'raw'));
    wrapFigures(tree, all);
    const after = JSON.stringify((tree.children ?? []).filter((node) => node.tagName !== 'figure'));
    expect(after).toBe(before);
    expect(tree.children?.filter((node) => node.tagName === 'h4')).toHaveLength(2);
  });

  it('clears the caption when a higher heading starts a new section', () => {
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Old caption'), heading('h2', 'Next section'), raw('<img src="/a.png">')],
    };
    wrapFigures(tree, none);
    const figure = tree.children?.[2];
    expect(figure?.tagName).toBe('figure');
    expect(figure?.children).toEqual([raw('<img src="/a.png" loading="eager" fetchpriority="high" decoding="async">')]);
  });

  it('wraps a paragraph that holds only a markdown image and keeps existing attributes', () => {
    const img = el('img', [], { src: '/b.png', alt: 'Screen B, empty', loading: 'eager' });
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'B'), el('p', [text('\n'), img, text(' ')])],
    };
    wrapFigures(tree, none);
    const figure = tree.children?.[1];
    expect(figure?.tagName).toBe('figure');
    expect(figure?.children?.[0]).toBe(img);
    expect(img.properties).toEqual({
      src: '/b.png',
      alt: 'Screen B, empty',
      loading: 'eager',
      decoding: 'async',
      fetchPriority: 'high',
    });
    expect(figure?.children?.[1]).toEqual(el('figcaption', [text('B')]));
  });

  it('gives a markdown image with an empty or file-name alt the caption as alt', () => {
    const empty = el('img', [], { src: '/c.png', alt: '' });
    const fileName = el('img', [], { src: '/mocks/04-login-modal.png', alt: '04-login-modal' });
    const tree: Node = {
      type: 'root',
      children: [heading('h4', 'Login Modal'), el('p', [empty]), el('p', [fileName])],
    };
    expect(wrapFigures(tree, none)).toBe(2);
    expect(empty.properties?.alt).toBe('Login Modal');
    expect(fileName.properties?.alt).toBe('Login Modal');
  });

  it('leaves a placeholder alt alone when there is no caption to use', () => {
    const tree: Node = {
      type: 'root',
      children: [raw('<img alt="Screenshot 2026-08-31 080518" src="/a.png">')],
    };
    wrapFigures(tree, none);
    expect(tree.children?.[0].children?.[0].value).toBe(
      '<img alt="Screenshot 2026-08-31 080518" src="/a.png" loading="eager" fetchpriority="high" decoding="async">',
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
    expect(wrapFigures(tree, all)).toBe(0);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('is exposed as a rehype plugin that forwards its options', () => {
    const tree = gistLike();
    rehypeFigures(all)(tree);
    const figures = tree.children?.filter((node) => node.tagName === 'figure') ?? [];
    expect(figures).toHaveLength(2);
    expect(figures[0].children?.[0].value).toContain('<picture>');

    const plain = gistLike();
    rehypeFigures(none)(plain);
    expect(JSON.stringify(plain)).not.toContain('<picture>');
  });
});
