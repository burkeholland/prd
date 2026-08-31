/**
 * A small, dependency-free line diff behind /history/<n>/: the text of one gist revision
 * against the previous one, as unified-diff hunks with line numbers.
 *
 * Line endings are normalised before diffing. Revisions 1–9 and 13–16 of the gist are CRLF,
 * 10–12 are LF, so git sees 9→10 and 12→13 as "every line changed" while the text edits are
 * small; `lineEndings()` lets the page say so instead.
 */

export type OpType = 'equal' | 'add' | 'del';

export interface Op {
  type: OpType;
  text: string;
  /** 1-based line number in the old text (`equal` and `del` ops). */
  aLine?: number;
  /** 1-based line number in the new text (`equal` and `add` ops). */
  bLine?: number;
}

export interface Hunk {
  /** First old line covered (`aCount > 0`), else the old line the change follows (0 = start). */
  aStart: number;
  aCount: number;
  /** First new line covered (`bCount > 0`), else the new line the change follows (0 = start). */
  bStart: number;
  bCount: number;
  ops: Op[];
}

export type Eol = 'CRLF' | 'LF' | 'mixed' | 'none';

/**
 * `\r\n` → `\n`, and the newline that terminates the last line is dropped (so are any blank
 * lines after it): a trailing newline is not a line. Idempotent.
 */
export function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

/** The lines of a text after `normalise()`; the empty text has no lines. */
export function lines(text: string): string[] {
  const clean = normalise(text);
  return clean === '' ? [] : clean.split('\n');
}

const toLines = (input: string | string[]): string[] => (typeof input === 'string' ? lines(input) : input);

/**
 * Line diff by longest common subsequence (dynamic programme, O(n·m) time and memory; the
 * gist's largest pair is ~800 × 800 lines). Strings are split with `lines()` first.
 * Inside a changed block every `del` precedes every `add`.
 */
export function diffLines(a: string | string[], b: string | string[]): Op[] {
  const left = toLines(a);
  const right = toLines(b);
  const n = left.length;
  const m = right.length;

  if (n === m && left.every((line, i) => line === right[i])) {
    return left.map((text, i) => ({ type: 'equal', text, aLine: i + 1, bLine: i + 1 }));
  }
  if (n === 0) return right.map((text, j) => ({ type: 'add', text, bLine: j + 1 }));
  if (m === 0) return left.map((text, i) => ({ type: 'del', text, aLine: i + 1 }));

  // lcs[i * width + j] = LCS length of left[i..] and right[j..]; the extra row/column is 0.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const next = row + width;
    for (let j = m - 1; j >= 0; j--) {
      lcs[row + j] =
        left[i] === right[j]
          ? lcs[next + j + 1] + 1
          : Math.max(lcs[next + j], lcs[row + j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && left[i] === right[j]) {
      ops.push({ type: 'equal', text: left[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      // Ties prefer the deletion, so a replaced block reads as its old lines then its new ones.
      ops.push({ type: 'del', text: left[i], aLine: i + 1 });
      i++;
    } else {
      ops.push({ type: 'add', text: right[j], bLine: j + 1 });
      j++;
    }
  }
  return ops;
}

/**
 * Groups the changes into hunks with `context` equal lines on either side. Two changes whose
 * context would overlap or touch (≤ 2 × `context` equal lines between them) share a hunk,
 * as in `diff -U`.
 */
export function hunks(ops: Op[], context = 3): Hunk[] {
  const ctx = Math.max(0, Math.floor(context));
  const ranges: { start: number; end: number }[] = [];
  ops.forEach((op, index) => {
    if (op.type === 'equal') return;
    const start = Math.max(0, index - ctx);
    const end = Math.min(ops.length - 1, index + ctx);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  });

  const out: Hunk[] = [];
  let aSeen = 0;
  let bSeen = 0;
  let cursor = 0;
  for (const range of ranges) {
    for (; cursor < range.start; cursor++) {
      const op = ops[cursor];
      if (op.type !== 'add') aSeen++;
      if (op.type !== 'del') bSeen++;
    }
    const slice = ops.slice(range.start, range.end + 1);
    const aCount = slice.filter((op) => op.type !== 'add').length;
    const bCount = slice.filter((op) => op.type !== 'del').length;
    out.push({
      aStart: aCount > 0 ? aSeen + 1 : aSeen,
      aCount,
      bStart: bCount > 0 ? bSeen + 1 : bSeen,
      bCount,
      ops: slice,
    });
    aSeen += aCount;
    bSeen += bCount;
    cursor = range.end + 1;
  }
  return out;
}

/** `@@ -a,c +b,d @@` for a hunk. */
export function hunkHeader(hunk: Hunk): string {
  return `@@ -${hunk.aStart},${hunk.aCount} +${hunk.bStart},${hunk.bCount} @@`;
}

/** Lines added and deleted, counted from the ops. */
export function summary(ops: Op[]): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const op of ops) {
    if (op.type === 'add') added++;
    else if (op.type === 'del') deleted++;
  }
  return { added, deleted };
}

/** Line-ending style of a raw (un-normalised) text. */
export function lineEndings(raw: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let at = raw.indexOf('\n'); at !== -1; at = raw.indexOf('\n', at + 1)) {
    if (at > 0 && raw.charCodeAt(at - 1) === 13) crlf++;
    else lf++;
  }
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'CRLF' : 'LF';
}
