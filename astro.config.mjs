// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { rehypeHeadingIds } from '@astrojs/markdown-remark';
import rehypeBase from './src/lib/rehype-base.mjs';
import rehypeFigures from './src/lib/rehype-figures.mjs';
import rehypeAnchors from './src/lib/rehype-anchors.mjs';

// GitHub Pages project site: https://burkeholland.github.io/prd/
// The base path is known in exactly two other places, both fed from here:
// `withBase()` (src/lib/base.ts, via import.meta.env.BASE_URL) for hrefs in .astro files,
// and the first rehype plugin below for URLs inside rendered markdown. The rehype pipeline
// runs in order: rehype-base (URLs), rehype-figures (screenshots → <figure>), Astro's
// rehypeHeadingIds (heading ids; listed explicitly because Astro's own run comes after user
// plugins), then rehype-anchors, which needs those ids to link each h2–h4 to itself.
// Custom domain later: base '/', site 'https://<domain>', plus public/CNAME.
const base = '/prd';

export default defineConfig({
  site: 'https://burkeholland.github.io',
  base,
  output: 'static',
  // Inline the one shared stylesheet (16 KB raw, 4.3 KB gzip): it was every page's only render-blocking
  // request, and GitHub Pages' max-age=600 on _astro/* makes the cross-page cache nearly worthless (#1522, #1529).
  build: { inlineStylesheets: 'always' },
  // Emits dist/sitemap-index.xml + sitemap-0.xml with the content pages in their canonical
  // (trailing-slash) form; the 404 page is a status page and never listed, and the per-revision
  // diff pages (/history/<n>/) are noindex and not listed either. <head> links to it.
  integrations: [
    sitemap({ filter: (page) => !/\/(404|500)\/?$/.test(page) && !/\/history\/\d+\/?$/.test(page) }),
  ],
  markdown: {
    shikiConfig: {
      // Both themes are emitted; global.css switches them with prefers-color-scheme.
      themes: { light: 'github-light', dark: 'github-dark' },
    },
    // Block-level images (the gist's screenshots) become lazy-loaded, captioned figures; then
    // every h2–h4 gets its id and becomes a link to itself (section permalinks).
    rehypePlugins: [[rehypeBase, { base }], rehypeFigures, rehypeHeadingIds, rehypeAnchors],
  },
});
