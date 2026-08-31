// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  markdown: {
    shikiConfig: {
      // Both themes are emitted; global.css switches them with prefers-color-scheme.
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
