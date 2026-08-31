import { describe, expect, it } from 'vitest';
import rehypeBase, { normalizeBase, rebase } from '../../src/lib/rehype-base.mjs';
import { withBase } from '../../src/lib/base';

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const el = (tagName: string, properties: Record<string, unknown>, children: Node[] = []): Node => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const run = (tree: Node, base?: string) => {
  rehypeBase({ base })(tree);
  return tree;
};

describe('rebase', () => {
  const base = '/prd';

  it('prefixes a file path with the base and keeps its name', () => {
    expect(rebase('/mocks/01-home-page.png', base)).toBe('/prd/mocks/01-home-page.png');
    expect(rebase('/raw/build-the-urlist.md', base)).toBe('/prd/raw/build-the-urlist.md');
  });

  it('prefixes a page path and gives it a trailing slash', () => {
    expect(rebase('/sample', base)).toBe('/prd/sample/');
    expect(rebase('/sample/', base)).toBe('/prd/sample/');
    expect(rebase('/', base)).toBe('/prd/');
  });

  it('keeps a fragment or query after the trailing slash', () => {
    expect(rebase('/sample#how', base)).toBe('/prd/sample/#how');
    expect(rebase('/sample?v=2#how', base)).toBe('/prd/sample/?v=2#how');
    expect(rebase('/mocks/a.png?v=2', base)).toBe('/prd/mocks/a.png?v=2');
  });

  it('leaves protocol-relative URLs alone', () => {
    expect(rebase('//cdn.example.com/x.png', base)).toBe('//cdn.example.com/x.png');
  });

  it('leaves absolute URLs alone', () => {
    expect(rebase('https://gist.github.com/x', base)).toBe('https://gist.github.com/x');
  });

  it('leaves fragment-only links alone', () => {
    expect(rebase('#anchor', base)).toBe('#anchor');
  });

  it('leaves relative paths alone', () => {
    expect(rebase('./x', base)).toBe('./x');
    expect(rebase('x', base)).toBe('x');
    expect(rebase('../up/x.png', base)).toBe('../up/x.png');
  });

  it('leaves mailto: and other schemes alone', () => {
    expect(rebase('mailto:hi@example.com', base)).toBe('mailto:hi@example.com');
    expect(rebase('tel:+1555', base)).toBe('tel:+1555');
  });

  it('leaves values already under the base alone', () => {
    expect(rebase('/prd/sample/', base)).toBe('/prd/sample/');
    expect(rebase('/prd', base)).toBe('/prd');
    expect(rebase('/prd#top', base)).toBe('/prd#top');
    // …but a sibling path that merely starts with the same letters is not "under" it.
    expect(rebase('/prdx', base)).toBe('/prd/prdx/');
  });

  it('is a no-op with an empty base', () => {
    expect(rebase('/sample', '')).toBe('/sample');
  });
});

describe('normalizeBase', () => {
  it('treats "", "/" and undefined as no base', () => {
    expect(normalizeBase('')).toBe('');
    expect(normalizeBase('/')).toBe('');
    expect(normalizeBase(undefined)).toBe('');
  });

  it('yields a leading slash and no trailing slash', () => {
    expect(normalizeBase('/prd')).toBe('/prd');
    expect(normalizeBase('/prd/')).toBe('/prd');
    expect(normalizeBase('prd')).toBe('/prd');
  });
});

describe('rehypeBase plugin', () => {
  it('rewrites a[href], img[src], source[src], video[src] and link[href]', () => {
    const tree = run(
      {
        type: 'root',
        children: [
          el('p', {}, [
            el('a', { href: '/sample' }, [{ type: 'text', value: 'sample' }]),
            el('a', { href: 'https://example.com/' }),
            el('img', { src: '/mocks/01-home-page.png', alt: 'home' }),
          ]),
          el('video', { src: '/clips/demo.mp4' }, [el('source', { src: '/clips/demo.webm' })]),
          el('link', { href: '/styles.css', rel: ['stylesheet'] }),
        ],
      },
      '/prd',
    );

    const [p, video, link] = tree.children as [Node, Node, Node];
    const [a, external, img] = p.children as [Node, Node, Node];
    expect(a.properties?.href).toBe('/prd/sample/');
    expect(external.properties?.href).toBe('https://example.com/');
    expect(img.properties?.src).toBe('/prd/mocks/01-home-page.png');
    expect(video.properties?.src).toBe('/prd/clips/demo.mp4');
    expect(video.children?.[0]?.properties?.src).toBe('/prd/clips/demo.webm');
    expect(link.properties?.href).toBe('/prd/styles.css');
  });

  it('ignores other elements and attributes', () => {
    const tree = run(
      {
        type: 'root',
        children: [
          el('form', { action: '/submit' }),
          el('div', { dataHref: '/x' }),
          el('a', { id: 'no-href' }),
        ],
      },
      '/prd',
    );
    const [form, div, a] = tree.children as [Node, Node, Node];
    expect(form.properties?.action).toBe('/submit');
    expect(div.properties?.dataHref).toBe('/x');
    expect(a.properties).toEqual({ id: 'no-href' });
  });

  it('rewrites raw HTML tags, which Astro turns into hast only after user plugins', () => {
    const raw =
      '<img width="1452" height="1580" alt="Screenshot 2026-08-31 080518" src="/mocks/01-home-page.png" />\n' +
      "<a href='/sample#how'>x</a> <a href=\"https://example.com/\">y</a> <img src=/mocks/02-new-list.png>\n" +
      '<div data-src="/not-an-img"></div>';
    const tree = run({ type: 'root', children: [{ type: 'raw', value: raw }] }, '/prd');
    expect(tree.children?.[0]?.value).toBe(
      '<img width="1452" height="1580" alt="Screenshot 2026-08-31 080518" src="/prd/mocks/01-home-page.png" />\n' +
        "<a href='/prd/sample/#how'>x</a> <a href=\"https://example.com/\">y</a> <img src=/prd/mocks/02-new-list.png>\n" +
        '<div data-src="/not-an-img"></div>',
    );
  });

  it('is a no-op when the base is "" or "/"', () => {
    for (const base of ['', '/']) {
      const tree = run(
        {
          type: 'root',
          children: [el('a', { href: '/sample' }), { type: 'raw', value: '<img src="/mocks/x.png">' }],
        },
        base,
      );
      expect(tree.children?.[0]?.properties?.href, `base "${base}"`).toBe('/sample');
      expect(tree.children?.[1]?.value, `base "${base}"`).toBe('<img src="/mocks/x.png">');
    }
  });
});

describe('withBase', () => {
  it('joins the path onto the base, stripping any trailing slash on the base', () => {
    expect(withBase('/sample/', '/prd')).toBe('/prd/sample/');
    expect(withBase('/sample/', '/prd/')).toBe('/prd/sample/');
    expect(withBase('/', '/prd')).toBe('/prd/');
    expect(withBase('/favicon.svg', '/prd')).toBe('/prd/favicon.svg');
  });

  it('returns the path unchanged for a root base (custom domain)', () => {
    expect(withBase('/sample/', '/')).toBe('/sample/');
    expect(withBase('/', '/')).toBe('/');
  });
});
