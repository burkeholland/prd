import {
  createDeterministicZipResponse,
  DETERMINISTIC_ZIP_DATE,
  DETERMINISTIC_ZIP_TIME,
  DETERMINISTIC_ZIP_UNIX_MODE,
  type DeterministicZipResponseFactory,
} from './deterministic-zip';

export const REFERENCE_BUNDLE_FILENAME = 'prd-reference-bundle.zip';
export const REFERENCE_BUNDLE_MIME = 'application/zip';
export const REFERENCE_BUNDLE_ZIP_TIME = DETERMINISTIC_ZIP_TIME;
export const REFERENCE_BUNDLE_ZIP_DATE = DETERMINISTIC_ZIP_DATE;
export const REFERENCE_BUNDLE_UNIX_MODE = DETERMINISTIC_ZIP_UNIX_MODE;

export const REFERENCE_BUNDLE_FILES = [
  { filename: 'prd-guide.md', mimeType: 'text/markdown; charset=utf-8' },
  {
    filename: 'prd-handoff-checklist.md',
    mimeType: 'text/markdown; charset=utf-8',
  },
  {
    filename: 'prd-example-walkthrough.md',
    mimeType: 'text/markdown; charset=utf-8',
  },
  {
    filename: 'prd-template-guide.md',
    mimeType: 'text/markdown; charset=utf-8',
  },
  { filename: 'prd-template.md', mimeType: 'text/markdown;charset=utf-8' },
] as const;

export type ReferenceBundleFilename =
  (typeof REFERENCE_BUNDLE_FILES)[number]['filename'];
export type ReferenceBundleResponseFactory = DeterministicZipResponseFactory;
export type ReferenceBundleSources = {
  [Filename in ReferenceBundleFilename]: ReferenceBundleResponseFactory;
};

export async function createReferenceBundleResponse(
  sources: Partial<ReferenceBundleSources>,
): Promise<Response> {
  return createDeterministicZipResponse({
    label: 'reference bundle',
    filename: REFERENCE_BUNDLE_FILENAME,
    mimeType: REFERENCE_BUNDLE_MIME,
    files: REFERENCE_BUNDLE_FILES,
    sources,
  });
}
