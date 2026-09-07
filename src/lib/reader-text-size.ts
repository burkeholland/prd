export const READER_TEXT_SIZE_STORAGE_KEY = 'prd-template:reader-text-size';

export const READER_TEXT_SIZE_PREFERENCES = ['default', 'large'] as const;

export type ReaderTextSizePreference =
  (typeof READER_TEXT_SIZE_PREFERENCES)[number];

export const isReaderTextSizePreference = (
  value: unknown,
): value is ReaderTextSizePreference =>
  typeof value === 'string' &&
  READER_TEXT_SIZE_PREFERENCES.some((preference) => preference === value);
