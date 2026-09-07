import { describe, expect, it } from 'vitest';
import {
  isReaderTextSizePreference,
  READER_TEXT_SIZE_PREFERENCES,
  READER_TEXT_SIZE_STORAGE_KEY,
  type ReaderTextSizePreference,
} from '../../src/lib/reader-text-size';

describe('reader text-size preference', () => {
  it('keeps the storage key and supported values version-stable', () => {
    const preferences: readonly ReaderTextSizePreference[] =
      READER_TEXT_SIZE_PREFERENCES;

    expect(READER_TEXT_SIZE_STORAGE_KEY).toBe(
      'prd-template:reader-text-size',
    );
    expect(preferences).toEqual(['default', 'large']);
  });

  it.each([
    ['default', true],
    ['large', true],
    ['Large', false],
    ['system', false],
    ['', false],
    [null, false],
    [undefined, false],
    [17, false],
    [{ value: 'large' }, false],
  ])('validates %j as %s', (value, expected) => {
    expect(isReaderTextSizePreference(value)).toBe(expected);
  });
});
