import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { loadExamplePrdState } from '../../lib/example-prd';
import {
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { generatePrdPdf } from '../../lib/prd-export-pdf';

export const prerender = true;

const require = createRequire(import.meta.url);
const font = (weight: 'Regular' | 'Bold') =>
  readFile(
    require.resolve(
      `pdfjs-dist/standard_fonts/LiberationSans-${weight}.ttf`,
    ),
  );

export const createBuildTheUrlistPdfResponse = async () => {
  const [state, regular, bold] = await Promise.all([
    loadExamplePrdState(),
    font('Regular'),
    font('Bold'),
  ]);
  const { bytes } = await generatePrdPdf(state, { regular, bold });
  return new Response(prdBytesResponseBody(bytes), {
    headers: {
      'Content-Type': PRD_EXPORT_MIME_TYPES.pdf,
      'Content-Disposition': 'attachment; filename="build-the-urlist.pdf"',
    },
  });
};

export const GET: APIRoute = createBuildTheUrlistPdfResponse;
