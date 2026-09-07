import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import {
  createExampleCaseStudyResponse,
  type ExampleCaseStudySources,
} from '../../lib/example-case-study';
import {
  createCurrentExampleMarkdownResponse,
  CURRENT_EXAMPLE_MARKDOWN_FILENAME,
} from '../../lib/example-markdown-download';
import { HISTORY_INDEX_DOWNLOAD } from '../../lib/history-index-download';
import {
  createWalkthroughMarkdownResponse,
  WALKTHROUGH_DOWNLOAD_FILENAME,
} from '../../lib/walkthrough-download';
import { createPrdRevisionHistoryResponse } from './prd-revision-history.md';

export const prerender = true;

export const createPrdExampleCaseStudyResponse = async () => {
  const walkthrough = await getEntry('docs', 'walkthrough');
  if (!walkthrough) {
    throw new Error('example case study: Walkthrough content entry is required');
  }

  const sources = {
    [CURRENT_EXAMPLE_MARKDOWN_FILENAME]:
      createCurrentExampleMarkdownResponse,
    [WALKTHROUGH_DOWNLOAD_FILENAME]: () =>
      createWalkthroughMarkdownResponse(walkthrough),
    [HISTORY_INDEX_DOWNLOAD.filename]: createPrdRevisionHistoryResponse,
  } satisfies ExampleCaseStudySources;

  return createExampleCaseStudyResponse(sources);
};

export const GET: APIRoute = createPrdExampleCaseStudyResponse;
