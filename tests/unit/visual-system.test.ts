import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLE_FILES = [
  'src/styles/global.css',
  'src/styles/print.css',
  'src/components/PrdEditor.astro',
  'src/pages/template.astro',
  'src/pages/history/[n].astro',
  'scripts/og.html',
] as const;

const styles = STYLE_FILES.map((file) => ({
  file,
  text: readFileSync(resolve(file), 'utf8'),
}));

describe('minimal visual system', () => {
  it('uses no gradients, backdrop filters, active shadows, transitions, or smooth scrolling', () => {
    for (const { file, text } of styles) {
      expect(text, file).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/i);
      expect(text, file).not.toMatch(/backdrop-filter\s*:/i);
      expect(text, file).not.toMatch(/box-shadow\s*:/i);
      expect(text, file).not.toMatch(/\btransition\s*:/i);
      expect(text, file).not.toMatch(/scroll-behavior\s*:\s*smooth/i);
    }
  });

  it('keeps every literal corner radius at eight pixels or less', () => {
    for (const { file, text } of styles) {
      const declarations = [...text.matchAll(/border-radius\s*:\s*([^;]+);/gi)];
      for (const declaration of declarations) {
        const value = declaration[1].trim();
        const pixels = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
        expect(pixels.every((radius) => radius <= 8), `${file}: border-radius ${value}`).toBe(true);
        expect(value, `${file}: border-radius ${value}`).not.toMatch(/%|999/);
      }
    }
  });
});
