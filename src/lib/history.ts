/**
 * Pure helpers behind /history: turn `content/gist/history.json` plus the verbatim
 * revision snapshots (`content/gist/history/NN-<short>.md`) into table rows.
 *
 * Facts about the data these functions have to respect:
 * - GitHub reports no line counts for the earliest revisions (`additions: 0, deletions: 0`
 *   does not mean nothing changed) → `hasCounts`.
 * - Some revisions are LF-only while the rest are CRLF, so one revision is a pure
 *   line-ending re-conversion → `lineEndingsOnly`.
 * - Early drafts used many short lines, so `lines` is not a growth measure; bytes and
 *   section count are.
 */

export interface HistoryRevision {
  n: number;
  version: string;
  short: string;
  committed_at: string;
  additions: number;
  deletions: number;
  total: number;
  url: string;
  /** Snapshot path relative to `content/gist/`, e.g. `history/16-8ef29d7.md`. */
  file: string;
  bytes: number;
  lines: number;
}

export interface HistoryDocument {
  id: string;
  owner: string;
  fetched_at: string;
  count: number;
  first_committed_at: string;
  last_committed_at: string;
  additions_total: number;
  deletions_total: number;
  /** Oldest → newest, `n` 1..count. */
  revisions: HistoryRevision[];
}

export interface Section {
  /** Trimmed h2 text; `""` for the h1 and anything else before the first `## `. */
  title: string;
  body: string;
}

export type Eol = 'CRLF' | 'LF' | 'mixed' | 'none';

export interface SectionDelta {
  added: string[];
  removed: string[];
  /** Same title, different normalised body. */
  changed: string[];
  unchanged: number;
  /** The raw strings differ but the normalised texts are identical (CRLF ↔ LF). */
  lineEndingsOnly: boolean;
  /** Line-ending style before and after; `changed` when a revision flipped it (GitHub then counts every line). */
  eol: { from: Eol | null; to: Eol; changed: boolean };
}

export interface HistoryRow {
  n: number;
  short: string;
  url: string;
  /** The revision's `committed_at` as given (ISO 8601). */
  committedAt: string;
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  /** `HH:MM UTC`. */
  time: string;
  additions: number;
  deletions: number;
  /** False when GitHub reported no line counts for the revision. */
  hasCounts: boolean;
  bytes: number;
  lines: number;
  /** Number of `## ` sections in the snapshot. */
  sectionCount: number;
  delta: SectionDelta;
  /** The revision the /sample page renders. */
  isCurrent: boolean;
}

export interface HistorySummary {
  count: number;
  /** Calendar days between the first and last commit, inclusive. */
  days: number;
  firstDate: string;
  lastDate: string;
  additions_total: number;
  deletions_total: number;
  firstBytes: number;
  lastBytes: number;
  firstSections: number;
  lastSections: number;
}

const H2 = /^## (.*)$/;

/**
 * Splits a snapshot on `## ` headings (h2 only). The `# ` h1 and any preamble form a
 * section titled `""`, emitted only when there is something in it. CRLF-tolerant.
 */
export function sections(md: string): Section[] {
  const out: Section[] = [];
  let title = '';
  let lines: string[] = [];
  const flush = () => {
    if (title !== '' || lines.some((line) => line.trim() !== '')) {
      out.push({ title, body: lines.join('\n') });
    }
  };
  for (const line of md.split(/\r?\n/)) {
    const match = H2.exec(line);
    if (match) {
      flush();
      title = (match[1] ?? '').trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  flush();
  return out;
}

/** `\r\n` → `\n`, trailing whitespace stripped from every line and from the end. */
export function normalise(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function bodiesByTitle(md: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const section of sections(md)) {
    const body = normalise(section.body);
    const existing = map.get(section.title);
    map.set(section.title, existing === undefined ? body : `${existing}\n${body}`);
  }
  return map;
}

/** Dominant line-ending style of a snapshot. */
export function lineEndings(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return 'none';
  if (crlf > 0 && lf > 0) return 'mixed';
  return crlf > 0 ? 'CRLF' : 'LF';
}

/** Compares two snapshots section by section (by h2 title). `prev === null` → everything is added. */
export function sectionDelta(prev: string | null, next: string): SectionDelta {
  const after = bodiesByTitle(next);
  const to = lineEndings(next);
  if (prev === null) {
    return {
      added: [...after.keys()],
      removed: [],
      changed: [],
      unchanged: 0,
      lineEndingsOnly: false,
      eol: { from: null, to, changed: false },
    };
  }
  const before = bodiesByTitle(prev);
  const added: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;
  for (const [title, body] of after) {
    if (!before.has(title)) added.push(title);
    else if (before.get(title) !== body) changed.push(title);
    else unchanged += 1;
  }
  const removed = [...before.keys()].filter((title) => !after.has(title));
  const lineEndingsOnly = prev !== next && normalise(prev) === normalise(next);
  const from = lineEndings(prev);
  return { added, removed, changed, unchanged, lineEndingsOnly, eol: { from, to, changed: from !== to } };
}

/** `2026-08-12T20:39:59Z` → `{ date: '2026-08-12', time: '20:39 UTC' }`. */
export function splitTimestamp(iso: string): { date: string; time: string } {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error(`history: bad timestamp "${iso}"`);
  const utc = parsed.toISOString();
  return { date: utc.slice(0, 10), time: `${utc.slice(11, 16)} UTC` };
}

/** One row per revision, oldest → newest. `snapshots` is keyed by `file` (e.g. `history/16-8ef29d7.md`). */
export function rows(
  history: HistoryDocument,
  snapshots: Record<string, string>,
  currentVersion: string,
): HistoryRow[] {
  const ordered = [...history.revisions].sort((a, b) => a.n - b.n);
  let prev: string | null = null;
  return ordered.map((rev) => {
    const md = snapshots[rev.file];
    if (md === undefined) throw new Error(`history: no snapshot for ${rev.file}`);
    const { date, time } = splitTimestamp(rev.committed_at);
    const row: HistoryRow = {
      n: rev.n,
      short: rev.short,
      url: rev.url,
      committedAt: rev.committed_at,
      date,
      time,
      additions: rev.additions,
      deletions: rev.deletions,
      hasCounts: rev.additions + rev.deletions > 0 || rev.n === 1,
      bytes: rev.bytes,
      lines: rev.lines,
      sectionCount: sections(md).filter((section) => section.title !== '').length,
      delta: sectionDelta(prev, md),
      isCurrent: rev.version === currentVersion,
    };
    prev = md;
    return row;
  });
}

/** Calendar days from `first` to `last` inclusive, by UTC date (same day → 1). */
export function inclusiveDays(first: string, last: string): number {
  const day = (iso: string) => {
    const d = new Date(iso);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.round((day(last) - day(first)) / 86_400_000) + 1;
}

export function summary(history: HistoryDocument, list: HistoryRow[]): HistorySummary {
  const first = list[0];
  const last = list[list.length - 1];
  return {
    count: history.count,
    days: inclusiveDays(history.first_committed_at, history.last_committed_at),
    firstDate: splitTimestamp(history.first_committed_at).date,
    lastDate: splitTimestamp(history.last_committed_at).date,
    additions_total: history.additions_total,
    deletions_total: history.deletions_total,
    firstBytes: first?.bytes ?? 0,
    lastBytes: last?.bytes ?? 0,
    firstSections: first?.sectionCount ?? 0,
    lastSections: last?.sectionCount ?? 0,
  };
}

/** Bar length per row: `bytes` linear against the largest `bytes`, the largest = `maxPx`. */
export function barScale(list: HistoryRow[], maxPx = 160): { px: number }[] {
  const max = Math.max(0, ...list.map((row) => row.bytes));
  return list.map((row) => ({ px: max > 0 ? Math.round((row.bytes / max) * maxPx * 100) / 100 : 0 }));
}

/** Bytes as decimal kilobytes: 25389 → `25.4`, or `25` with `digits = 0`. */
export function kb(bytes: number, digits = 1): string {
  return (bytes / 1000).toFixed(digits);
}

const INTRO = 'Intro';
const label = (title: string) => (title === '' ? INTRO : title);

/**
 * The "What changed" cell: e.g. `Added: Data model, Auth; Changed: Home page; Removed: Notes`.
 * A flipped line-ending style is named too, because GitHub then counts every line as changed.
 */
export function describeDelta(row: HistoryRow): string {
  if (row.n === 1) return `First draft — ${row.sectionCount} sections`;
  if (row.delta.lineEndingsOnly) return 'Line endings only (CRLF ↔ LF); no text changed';
  const groups: [string, string[]][] = [
    ['Added', row.delta.added],
    ['Changed', row.delta.changed],
    ['Removed', row.delta.removed],
  ];
  const parts = groups
    .filter(([, titles]) => titles.length > 0)
    .map(([name, titles]) => `${name}: ${titles.map(label).join(', ')}`);
  if (row.delta.eol.changed) parts.push(`line endings ${row.delta.eol.from} → ${row.delta.eol.to}`);
  return parts.length > 0 ? parts.join('; ') : 'No text changed';
}
