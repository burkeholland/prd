import type { APIRoute } from 'astro';
import { loadExamplePrdState } from '../../lib/example-prd';
import {
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { exportPrdDocx } from '../../lib/prd-export-docx';

export const prerender = true;

export const createBuildTheUrlistDocxResponse = async () =>
  new Response(
    prdBytesResponseBody(await exportPrdDocx(await loadExamplePrdState())),
    {
      headers: {
        'Content-Type': PRD_EXPORT_MIME_TYPES.docx,
        'Content-Disposition':
          'attachment; filename="build-the-urlist.docx"',
      },
    },
  );

export const GET: APIRoute = createBuildTheUrlistDocxResponse;
