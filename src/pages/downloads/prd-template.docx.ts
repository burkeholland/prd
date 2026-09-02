import type { APIRoute } from 'astro';
import {
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { exportPrdDocx } from '../../lib/prd-export-docx';
import { createBlankPrdTemplateState } from '../../lib/prd-template';

export const prerender = true;

export const createPrdTemplateDocxResponse = async () =>
  new Response(
    prdBytesResponseBody(
      await exportPrdDocx(createBlankPrdTemplateState(), {
        blankPlaceholders: true,
      }),
    ),
    {
      headers: {
        'Content-Type': PRD_EXPORT_MIME_TYPES.docx,
        'Content-Disposition': 'attachment; filename="prd-template.docx"',
      },
    },
  );

export const GET: APIRoute = createPrdTemplateDocxResponse;
