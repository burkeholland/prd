// @ts-check
import { defineConfig } from 'astro/config';
import rehypeBase from './src/lib/rehype-base.mjs';

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
  markdown: {
    shikiConfig: {
      // Both themes are emitted; global.css switches them with prefers-color-scheme.
      themes: { light: 'github-light', dark: 'github-dark' },
    },
    rehypePlugins: [[rehypeBase, { base }]],
  },
});
