import {
  createDeterministicZipResponse,
  DETERMINISTIC_ZIP_DATE,
  DETERMINISTIC_ZIP_TIME,
  DETERMINISTIC_ZIP_UNIX_MODE,
  type DeterministicZipResponseFactory,
} from './deterministic-zip';
import {
  CURRENT_EXAMPLE_MARKDOWN_FILENAME,
  CURRENT_EXAMPLE_MARKDOWN_MIME,
} from './example-markdown-download';
import { HISTORY_INDEX_DOWNLOAD } from './history-index-download';
import {
  WALKTHROUGH_DOWNLOAD_FILENAME,
  WALKTHROUGH_MARKDOWN_MIME,
} from './walkthrough-download';

export const EXAMPLE_CASE_STUDY_PATH =
  '/downloads/prd-example-case-study.zip';
export const EXAMPLE_CASE_STUDY_FILENAME = 'prd-example-case-study.zip';
export const EXAMPLE_CASE_STUDY_MIME = 'application/zip';
export const EXAMPLE_CASE_STUDY_ZIP_TIME = DETERMINISTIC_ZIP_TIME;
export const EXAMPLE_CASE_STUDY_ZIP_DATE = DETERMINISTIC_ZIP_DATE;
export const EXAMPLE_CASE_STUDY_UNIX_MODE = DETERMINISTIC_ZIP_UNIX_MODE;

export const EXAMPLE_CASE_STUDY_FILES = [
  {
    filename: CURRENT_EXAMPLE_MARKDOWN_FILENAME,
    mimeType: CURRENT_EXAMPLE_MARKDOWN_MIME,
  },
  {
    filename: WALKTHROUGH_DOWNLOAD_FILENAME,
    mimeType: WALKTHROUGH_MARKDOWN_MIME,
  },
  {
    filename: HISTORY_INDEX_DOWNLOAD.filename,
    mimeType: HISTORY_INDEX_DOWNLOAD.mime,
  },
] as const;

export type ExampleCaseStudyFilename =
  (typeof EXAMPLE_CASE_STUDY_FILES)[number]['filename'];
export type ExampleCaseStudySources = {
  [Filename in ExampleCaseStudyFilename]: DeterministicZipResponseFactory;
};

export const createExampleCaseStudyResponse = (
  sources: Partial<ExampleCaseStudySources>,
): Promise<Response> =>
  createDeterministicZipResponse({
    label: 'example case study',
    filename: EXAMPLE_CASE_STUDY_FILENAME,
    mimeType: EXAMPLE_CASE_STUDY_MIME,
    files: EXAMPLE_CASE_STUDY_FILES,
    sources,
  });
