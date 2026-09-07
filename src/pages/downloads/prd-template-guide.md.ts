import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { createTemplateGuideMarkdownResponse } from '../../lib/template-guide';

export const prerender = true;

export const GET: APIRoute = async () => {
  const entry = await getEntry('docs', 'template');
  if (!entry) {
    throw new Error('template guide download: content entry is required');
  }
  return createTemplateGuideMarkdownResponse(entry);
};
