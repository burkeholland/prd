import { readFile } from 'node:fs/promises';
import {
  parsePrdExportMarkdown,
  type PrdExportDocument,
} from './prd-export-document';

const EXAMPLE_SOURCE = new URL(
  '../../content/gist/build-the-urlist.md',
  import.meta.url,
);

export const parseExamplePrdMarkdown = (
  source: string,
): PrdExportDocument => {
  const parsed = parsePrdExportMarkdown(source);
  if (parsed.status === 'invalid') {
    throw new Error(
      `Example download generation failed: content/gist/build-the-urlist.md could not be parsed (${parsed.reason}).`,
    );
  }
  return parsed.document;
};

export const loadExamplePrdDocument = async (): Promise<PrdExportDocument> =>
  parseExamplePrdMarkdown(await readFile(EXAMPLE_SOURCE, 'utf8'));
