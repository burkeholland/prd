import type { APIRoute } from 'astro';
import guideSource from '../../../content/guide.md?raw';
import {
  extractHandoffChecklistItems,
  HANDOFF_CHECKLIST_FILENAME,
  HANDOFF_CHECKLIST_MIME,
  serializeHandoffChecklist,
} from '../../lib/handoff-checklist';

export const prerender = true;

export const handoffChecklistItems =
  extractHandoffChecklistItems(guideSource);

export const createHandoffChecklistResponse = () =>
  new Response(serializeHandoffChecklist(handoffChecklistItems), {
    status: 200,
    headers: {
      'Content-Type': HANDOFF_CHECKLIST_MIME,
      'Content-Disposition': `attachment; filename="${HANDOFF_CHECKLIST_FILENAME}"`,
    },
  });

export const GET = createHandoffChecklistResponse satisfies APIRoute;
