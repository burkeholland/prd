import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { generatePrdPdf } from '../../lib/prd-export-pdf';
import { createBlankPrdTemplateState } from '../../lib/prd-template';

export const prerender = true;

const require = createRequire(import.meta.url);
const font = (weight: 400 | 700) =>
  readFile(
    require.resolve(
      `@fontsource/noto-sans/files/noto-sans-latin-${weight}-normal.woff`,
    ),
  );

export const createPrdTemplatePdfResponse = async () => {
  const [regular, bold] = await Promise.all([font(400), font(700)]);
  const { bytes } = await generatePrdPdf(
    createBlankPrdTemplateState(),
    { regular, bold },
    { blankPlaceholders: true },
  );
  return new Response(prdBytesResponseBody(bytes), {
    headers: {
      'Content-Type': PRD_EXPORT_MIME_TYPES.pdf,
      'Content-Disposition': 'attachment; filename="prd-template.pdf"',
    },
  });
};

export const GET: APIRoute = createPrdTemplatePdfResponse;
