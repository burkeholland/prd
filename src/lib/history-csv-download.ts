import type { HistoryDocument, HistoryRevision } from './history';
import {
  historyRevisionGithubUrl,
  historyRevisionMarkdownUrl,
  historyRevisionPublicUrl,
} from './history-downloads';
import { SITE } from './site';

export const HISTORY_CSV_DOWNLOAD = {
  path: '/downloads/prd-revision-history.csv',
  filename: 'prd-revision-history.csv',
  label: 'Download metrics (.csv)',
  mime: 'text/csv; charset=utf-8',
} as const;

export const HISTORY_CSV_REVISION_COUNT = 16;

export interface HistoryCsvSource {
  history: HistoryDocument;
  current: { revision: string };
}

type CsvCell = string | number | boolean;
type HistoryCsvRow = readonly [
  revision: number,
  current: boolean,
  committedAt: string,
  bytes: number,
  lines: number,
  additions: number,
  deletions: number,
  total: number,
  publicUrl: string,
  githubUrl: string,
  markdownUrl: string,
];

const HEADER =
  'revision,current,committed_at,bytes,lines,additions,deletions,total,public_url,github_url,markdown_url';

export function escapeCsvCell(value: CsvCell): string {
  const text = String(value).replace(/\r\n|\r|\n/g, '\r\n');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const metric = (value: unknown, name: string): number => {
  if (value === '') {
    throw new Error(`Revision history CSV: ${name} is blank.`);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Revision history CSV: ${name} must be a non-negative integer.`);
  }
  return value;
};

const scalar = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Revision history CSV: ${name} is missing or blank.`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`Revision history CSV: ${name} contains an unsafe line break.`);
  }
  return value;
};

const utcTimestamp = (value: unknown, name: string): string => {
  const timestamp = scalar(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`Revision history CSV: ${name} is not a valid UTC timestamp.`);
  }
  const canonical = timestamp.includes('.')
    ? timestamp
    : timestamp.replace(/Z$/, '.000Z');
  if (new Date(timestamp).toISOString() !== canonical) {
    throw new Error(`Revision history CSV: ${name} is not a valid UTC timestamp.`);
  }
  return timestamp;
};

const validateRevision = (
  revision: HistoryRevision,
  index: number,
  currentVersion: string,
): HistoryCsvRow => {
  if (!revision || typeof revision !== 'object') {
    throw new Error(
      `Revision history CSV: revision record ${index + 1} is missing or malformed.`,
    );
  }
  const number = metric(revision.n, `revision number at position ${index + 1}`);
  if (number !== index + 1) {
    throw new Error(
      'Revision history CSV: revision numbers are out of order; expected oldest to newest.',
    );
  }
  const label = `revision ${number}`;
  const version = scalar(revision.version, `${label} version`);
  const short = scalar(revision.short, `${label} short SHA`);
  if (!/^[0-9a-f]{40}$/.test(version)) {
    throw new Error(`Revision history CSV: ${label} has an invalid version SHA.`);
  }
  if (short !== version.slice(0, 7) || !/^[0-9a-f]{7}$/.test(short)) {
    throw new Error(`Revision history CSV: ${label} has an invalid short SHA.`);
  }
  const committedAt = utcTimestamp(revision.committed_at, `${label} timestamp`);
  const bytes = metric(revision.bytes, `${label} bytes`);
  const lines = metric(revision.lines, `${label} lines`);
  const additions = metric(revision.additions, `${label} additions`);
  const deletions = metric(revision.deletions, `${label} deletions`);
  const total = metric(revision.total, `${label} total changes`);
  if (bytes === 0 || lines === 0) {
    throw new Error(`Revision history CSV: ${label} has a blank metric.`);
  }
  if (total !== additions + deletions) {
    throw new Error(`Revision history CSV: ${label} change metrics do not add up.`);
  }
  scalar(revision.url, `${label} GitHub URL`);
  return [
    number,
    version === currentVersion,
    committedAt,
    bytes,
    lines,
    additions,
    deletions,
    total,
    historyRevisionPublicUrl(revision),
    historyRevisionGithubUrl(revision),
    historyRevisionMarkdownUrl(revision),
  ];
};

const rows = (source: HistoryCsvSource): HistoryCsvRow[] => {
  if (!source || typeof source !== 'object') {
    throw new Error('Revision history CSV: source data is missing or malformed.');
  }
  const { history, current } = source;
  if (!history || typeof history !== 'object' || !Array.isArray(history.revisions)) {
    throw new Error('Revision history CSV: history data is missing or malformed.');
  }
  const count = metric(history.count, 'history count');
  if (count !== HISTORY_CSV_REVISION_COUNT) {
    throw new Error(
      `Revision history CSV: expected exactly ${HISTORY_CSV_REVISION_COUNT} revisions, found ${count}.`,
    );
  }
  if (history.revisions.length !== HISTORY_CSV_REVISION_COUNT) {
    throw new Error(
      `Revision history CSV: expected exactly ${HISTORY_CSV_REVISION_COUNT} revision records, found ${history.revisions.length}.`,
    );
  }
  const id = scalar(history.id, 'history id');
  const owner = scalar(history.owner, 'history owner');
  if (SITE.gistUrl !== `https://gist.github.com/${owner}/${id}`) {
    throw new Error('Revision history CSV: history identity does not match the configured gist.');
  }
  if (!current || typeof current !== 'object') {
    throw new Error(
      'Revision history CSV: current revision metadata is missing or malformed.',
    );
  }
  const currentVersion = scalar(current.revision, 'current revision');
  if (!/^[0-9a-f]{40}$/.test(currentVersion)) {
    throw new Error('Revision history CSV: current revision has an invalid version SHA.');
  }

  const firstCommittedAt = utcTimestamp(
    history.first_committed_at,
    'first committed timestamp',
  );
  const lastCommittedAt = utcTimestamp(
    history.last_committed_at,
    'last committed timestamp',
  );
  utcTimestamp(history.fetched_at, 'history fetched timestamp');
  const additionsTotal = metric(history.additions_total, 'history additions total');
  const deletionsTotal = metric(history.deletions_total, 'history deletions total');
  const validated = history.revisions.map((revision, index) =>
    validateRevision(revision, index, currentVersion),
  );

  if (firstCommittedAt !== validated[0]![2]) {
    throw new Error(
      'Revision history CSV: first committed timestamp does not match revision 1.',
    );
  }
  if (lastCommittedAt !== validated.at(-1)![2]) {
    throw new Error(
      `Revision history CSV: last committed timestamp does not match revision ${HISTORY_CSV_REVISION_COUNT}.`,
    );
  }
  for (let index = 1; index < validated.length; index += 1) {
    if (Date.parse(validated[index - 1]![2]) > Date.parse(validated[index]![2])) {
      throw new Error(
        'Revision history CSV: revision timestamps are out of chronological order.',
      );
    }
  }
  const currentCount = validated.filter((revision) => revision[1]).length;
  if (currentCount !== 1) {
    throw new Error(
      `Revision history CSV: expected exactly one current revision, found ${currentCount}.`,
    );
  }
  if (new Set(history.revisions.map((revision) => revision.version)).size !== count) {
    throw new Error('Revision history CSV: duplicate revision versions.');
  }
  if (
    validated.reduce((total, revision) => total + revision[5], 0) !==
      additionsTotal ||
    validated.reduce((total, revision) => total + revision[6], 0) !==
      deletionsTotal
  ) {
    throw new Error(
      'Revision history CSV: aggregate change metrics do not match the revision records.',
    );
  }
  return validated;
};

export function serializeHistoryCsv(source: HistoryCsvSource): string {
  const records = rows(source).map((record) =>
    record.map(escapeCsvCell).join(','),
  );
  return [HEADER, ...records].join('\r\n') + '\r\n';
}

export function createHistoryCsvResponse(source: HistoryCsvSource): Response {
  return new Response(serializeHistoryCsv(source), {
    status: 200,
    headers: {
      'Content-Type': HISTORY_CSV_DOWNLOAD.mime,
      'Content-Disposition':
        `attachment; filename="${HISTORY_CSV_DOWNLOAD.filename}"`,
    },
  });
}
