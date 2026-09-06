import type { APIRoute } from 'astro';
import { createPrdTemplateMarkdownResponse } from './downloads/prd-template.md';

export const prerender = true;

export const GET = createPrdTemplateMarkdownResponse satisfies APIRoute;
