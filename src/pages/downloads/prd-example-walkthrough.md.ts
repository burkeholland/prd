import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { createWalkthroughMarkdownResponse } from '../../lib/walkthrough-download';

export const prerender = true;

export const GET: APIRoute = async () => {
  const entry = await getEntry('docs', 'walkthrough');
  if (!entry) {
    throw new Error('walkthrough download: content entry is required');
  }
  return createWalkthroughMarkdownResponse(entry);
};
