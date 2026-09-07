import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import guideSource from '../../../content/guide.md?raw';
import {
  assertGuideDownloadSource,
  createGuideMarkdownResponse,
} from '../../lib/guide-download';

export const prerender = true;

assertGuideDownloadSource(guideSource);

export const GET: APIRoute = async () => {
  const entry = await getEntry('docs', 'guide');
  if (!entry) {
    throw new Error('guide download: content entry is required');
  }
  return createGuideMarkdownResponse(entry);
};
