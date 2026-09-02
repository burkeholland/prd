import type { APIRoute } from 'astro';
import {
  exportPrdMarkdown,
  prdBytesResponseBody,
  PRD_EXPORT_MIME_TYPES,
} from '../../lib/prd-export';
import { createBlankPrdTemplateState } from '../../lib/prd-template';

export const prerender = true;

export const createPrdTemplateMarkdownResponse = () =>
  new Response(
    prdBytesResponseBody(
      exportPrdMarkdown(createBlankPrdTemplateState(), {
        blankPlaceholders: true,
      }),
    ),
    {
      headers: {
        'Content-Type': PRD_EXPORT_MIME_TYPES.md,
        'Content-Disposition': 'attachment; filename="prd-template.md"',
      },
    },
  );

export const GET: APIRoute = createPrdTemplateMarkdownResponse;
