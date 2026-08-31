// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeBase from './src/lib/rehype-base.mjs';
import rehypeFigures from './src/lib/rehype-figures.mjs';

// GitHub Pages project site: https://burkeholland.github.io/prd/
// The base path is known in exactly two other places, both fed from here:
// `withBase()` (src/lib/base.ts, via import.meta.env.BASE_URL) for hrefs in .astro files,
// and the rehype plugin below for URLs inside rendered markdown.
// Custom domain later: base '/', site 'https://<domain>', plus public/CNAME.
const base = '/prd';

export default defineConfig({
  site: 'https://burkeholland.github.io',
  base,
  output: 'static',
  // Emits dist/sitemap-index.xml + sitemap-0.xml with the five pages in their canonical
  // (trailing-slash) form; the 404 page is a status page and never listed. <head> links to it.
  integrations: [sitemap({ filter: (page) => !/\/(404|500)\/?$/.test(page) })],
  markdown: {
    shikiConfig: {
      // Both themes are emitted; global.css switches them with prefers-color-scheme.
      themes: { light: 'github-light', dark: 'github-dark' },
    },
    // Block-level images (the gist's screenshots) become lazy-loaded, captioned figures.
    rehypePlugins: [[rehypeBase, { base }], rehypeFigures],
  },
});
