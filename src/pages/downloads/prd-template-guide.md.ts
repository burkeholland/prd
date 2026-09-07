import type { APIRoute } from 'astro';
import { prdBytesResponseBody } from '../../lib/prd-export';
import { loadTemplateGuideMarkdownBytes } from '../../lib/template-guide';

export const prerender = true;

export const TEMPLATE_GUIDE_MIME_TYPE = 'text/markdown; charset=utf-8';
export const TEMPLATE_GUIDE_FILENAME = 'prd-template-guide.md';

export const createPrdTemplateGuideMarkdownResponse = async () =>
  new Response(
    prdBytesResponseBody(await loadTemplateGuideMarkdownBytes()),
    {
      headers: {
        'Content-Type': TEMPLATE_GUIDE_MIME_TYPE,
        'Content-Disposition':
          `attachment; filename="${TEMPLATE_GUIDE_FILENAME}"`,
      },
    },
  );

export const GET: APIRoute = createPrdTemplateGuideMarkdownResponse;
