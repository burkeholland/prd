import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import {
  createGuideMarkdownResponse,
  GUIDE_DOWNLOAD_FILENAME,
} from '../../lib/guide-download';
import {
  HANDOFF_CHECKLIST_FILENAME,
} from '../../lib/handoff-checklist';
import {
  createReferenceBundleResponse,
  type ReferenceBundleSources,
} from '../../lib/reference-bundle';
import {
  createTemplateGuideMarkdownResponse,
  TEMPLATE_GUIDE_DOWNLOAD_FILENAME,
} from '../../lib/template-guide';
import {
  createWalkthroughMarkdownResponse,
  WALKTHROUGH_DOWNLOAD_FILENAME,
} from '../../lib/walkthrough-download';
import { createHandoffChecklistResponse } from './prd-handoff-checklist.md';
import { createPrdTemplateMarkdownResponse } from './prd-template.md';

export const prerender = true;

export const createPrdReferenceBundleResponse = async () => {
  const [guide, walkthrough, templateGuide] = await Promise.all([
    getEntry('docs', 'guide'),
    getEntry('docs', 'walkthrough'),
    getEntry('docs', 'template'),
  ]);
  if (!guide) {
    throw new Error('reference bundle: Guide content entry is required');
  }
  if (!walkthrough) {
    throw new Error('reference bundle: Walkthrough content entry is required');
  }
  if (!templateGuide) {
    throw new Error('reference bundle: Template guide content entry is required');
  }

  const sources = {
    [GUIDE_DOWNLOAD_FILENAME]: () => createGuideMarkdownResponse(guide),
    [HANDOFF_CHECKLIST_FILENAME]: createHandoffChecklistResponse,
    [WALKTHROUGH_DOWNLOAD_FILENAME]: () =>
      createWalkthroughMarkdownResponse(walkthrough),
    [TEMPLATE_GUIDE_DOWNLOAD_FILENAME]: () =>
      createTemplateGuideMarkdownResponse(templateGuide),
    'prd-template.md': createPrdTemplateMarkdownResponse,
  } satisfies ReferenceBundleSources;

  return createReferenceBundleResponse(sources);
};

export const GET: APIRoute = createPrdReferenceBundleResponse;
