const PRD_WORD_PATTERN =
  /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’\p{Pd}][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;

export function countPrdWords(value: string): number {
  return value.match(PRD_WORD_PATTERN)?.length ?? 0;
}

export function formatPrdWordCount(count: number): string {
  return `${count} ${count === 1 ? 'word' : 'words'}`;
}
