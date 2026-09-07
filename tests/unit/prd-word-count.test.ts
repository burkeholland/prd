import { describe, expect, it } from 'vitest';
import {
  countPrdWords,
  formatPrdWordCount,
} from '../../src/lib/prd-word-count';

describe('PRD word count', () => {
  it.each([
    ['', 0],
    [' \t\r\n ', 0],
    ['.,;:!?—–-\'’()[]{}…', 0],
    ['Café 日本語 १२३ e\u0301', 4],
    ['one\r\ntwo\rthree\nfour', 4],
    ['🌱 🧑🏽‍💻 ❤️', 0],
    ['🌱 release 🚀', 1],
  ])('counts Unicode letters and numbers in %j as %i words', (value, expected) => {
    expect(countPrdWords(value)).toBe(expected);
  });

  it('joins letters or numbers across one internal apostrophe or Unicode dash', () => {
    expect(countPrdWords("can't mother-in-law l’équipe co–operate version-2")).toBe(5);
  });

  it('ignores leading and trailing punctuation and splits repeated joiners', () => {
    expect(countPrdWords("'leading trailing- rock--roll word''break")).toBe(6);
  });

  it.each([
    [0, '0 words'],
    [1, '1 word'],
    [24, '24 words'],
  ])('formats %i with exact singular or plural text', (count, expected) => {
    expect(formatPrdWordCount(count)).toBe(expected);
  });
});
