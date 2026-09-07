import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prdBytesResponseBody } from './prd-export';

const CURRENT_EXAMPLE_SOURCE = resolve('public/raw/build-the-urlist.md');

export const CURRENT_EXAMPLE_MARKDOWN_PATH = '/raw/build-the-urlist.md';
export const CURRENT_EXAMPLE_MARKDOWN_FILENAME = 'build-the-urlist.md';
export const CURRENT_EXAMPLE_MARKDOWN_MIME = 'text/markdown; charset=utf-8';

export const createCurrentExampleMarkdownResponse = async (): Promise<Response> => {
  const bytes = await readFile(CURRENT_EXAMPLE_SOURCE);
  return new Response(prdBytesResponseBody(bytes), {
    status: 200,
    headers: {
      'Content-Type': CURRENT_EXAMPLE_MARKDOWN_MIME,
      'Content-Disposition':
        `attachment; filename="${CURRENT_EXAMPLE_MARKDOWN_FILENAME}"`,
    },
  });
};
