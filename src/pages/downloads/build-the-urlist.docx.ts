import type { APIRoute } from 'astro';
import { loadExamplePrdDocument } from '../../lib/example-prd';
import {
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { exportPrdDocumentDocx } from '../../lib/prd-export-docx';

export const prerender = true;

export const createBuildTheUrlistDocxResponse = async () =>
  new Response(
    prdBytesResponseBody(
      await exportPrdDocumentDocx(await loadExamplePrdDocument()),
    ),
    {
      headers: {
        'Content-Type': PRD_EXPORT_MIME_TYPES.docx,
        'Content-Disposition':
          'attachment; filename="build-the-urlist.docx"',
      },
    },
  );

export const GET: APIRoute = createBuildTheUrlistDocxResponse;
