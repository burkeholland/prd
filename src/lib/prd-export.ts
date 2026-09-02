import {
  serializePrdMarkdown,
  type PrdTemplateStateInput,
  type SerializePrdMarkdownOptions,
} from './prd-template';

export const PRD_EXPORT_MIME_TYPES = {
  md: 'text/markdown;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

export type PrdExportFormat = keyof typeof PRD_EXPORT_MIME_TYPES;

const FALLBACK_FILENAME = 'product-requirements-document';

export const sanitizePrdFilename = (title: string | null | undefined): string => {
  const filename = (title ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return Array.from(filename).slice(0, 80).join('').replace(/-+$/g, '') || FALLBACK_FILENAME;
};

export const prdExportFilename = (
  title: string | null | undefined,
  format: PrdExportFormat,
): string => `${sanitizePrdFilename(title)}.${format}`;

export const exportPrdMarkdown = (
  state: PrdTemplateStateInput,
  options: SerializePrdMarkdownOptions = {},
): Uint8Array => new TextEncoder().encode(serializePrdMarkdown(state, options));

export const prdBytesResponseBody = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};
