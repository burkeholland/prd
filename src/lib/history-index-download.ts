import type { HistoryDocument, HistoryRevision } from './history';
import {
  assertHistorySnapshotCoverage,
  historyRevisionGithubUrl,
  historyRevisionMarkdownUrl,
  historyRevisionPublicUrl,
} from './history-downloads';
import { SITE } from './site';

export const HISTORY_INDEX_DOWNLOAD = {
  path: '/downloads/prd-revision-history.md',
  filename: 'prd-revision-history.md',
  label: 'Download history index (.md)',
  mime: 'text/markdown; charset=utf-8',
} as const;

export const HISTORY_INDEX_REVISION_COUNT = 16;

type Snapshot = string | Uint8Array;

export interface CurrentRevisionMetadata {
  revision: string;
}

export interface HistoryIndexSource {
  history: HistoryDocument;
  snapshots: Record<string, Snapshot>;
  current: CurrentRevisionMetadata;
  notes: Readonly<Record<string, string>>;
}

const scalar = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Revision history index: ${name} is missing or blank.`);
  }
  if (/[\r\n]/.test(value)) {
    throw new Error(`Revision history index: ${name} contains an unsafe line break.`);
  }
  return value;
};

const metric = (value: unknown, name: string): number => {
  if (value === '') {
    throw new Error(`Revision history index: ${name} is blank.`);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Revision history index: ${name} must be a non-negative integer.`);
  }
  return value;
};

const utcTimestamp = (value: unknown, name: string): string => {
  const timestamp = scalar(value, name);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`Revision history index: ${name} is not a valid UTC timestamp.`);
  }
  const canonical = timestamp.includes('.')
    ? timestamp
    : timestamp.replace(/Z$/, '.000Z');
  if (new Date(timestamp).toISOString() !== canonical) {
    throw new Error(`Revision history index: ${name} is not a valid UTC timestamp.`);
  }
  return timestamp;
};

const validateRevisionNumbers = (revisions: readonly HistoryRevision[]): void => {
  const numbers = revisions.map((revision, index) =>
    metric(revision?.n, `revision number at position ${index + 1}`),
  );
  if (new Set(numbers).size !== numbers.length) {
    throw new Error('Revision history index: duplicate revision numbers.');
  }
  const missing = Array.from(
    { length: HISTORY_INDEX_REVISION_COUNT },
    (_, index) => index + 1,
  ).filter((number) => !numbers.includes(number));
  if (missing.length > 0) {
    throw new Error(
      `Revision history index: missing revision numbers ${missing.join(', ')}.`,
    );
  }
  if (numbers.some((number, index) => number !== index + 1)) {
    throw new Error(
      'Revision history index: revision numbers are out of order; expected oldest to newest.',
    );
  }
};

const validateSource = (source: HistoryIndexSource) => {
  if (!source || typeof source !== 'object') {
    throw new Error('Revision history index: source data is missing or malformed.');
  }
  const { history, snapshots, current, notes } = source;
  if (!history || typeof history !== 'object' || !Array.isArray(history.revisions)) {
    throw new Error('Revision history index: history data is missing or malformed.');
  }
  const count = metric(history.count, 'history count');
  if (count !== HISTORY_INDEX_REVISION_COUNT) {
    throw new Error(
      `Revision history index: expected exactly ${HISTORY_INDEX_REVISION_COUNT} revisions, found ${count}.`,
    );
  }
  if (history.revisions.length !== HISTORY_INDEX_REVISION_COUNT) {
    throw new Error(
      `Revision history index: expected exactly ${HISTORY_INDEX_REVISION_COUNT} revision records, found ${history.revisions.length}.`,
    );
  }
  validateRevisionNumbers(history.revisions);

  const id = scalar(history.id, 'history id');
  const owner = scalar(history.owner, 'history owner');
  if (SITE.gistUrl !== `https://gist.github.com/${owner}/${id}`) {
    throw new Error('Revision history index: history identity does not match the configured gist.');
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
  metric(history.additions_total, 'history additions total');
  metric(history.deletions_total, 'history deletions total');
  if (!snapshots || typeof snapshots !== 'object') {
    throw new Error('Revision history index: snapshot data is missing or malformed.');
  }
  if (!current || typeof current !== 'object') {
    throw new Error('Revision history index: current revision metadata is missing or malformed.');
  }
  const currentVersion = scalar(current.revision, 'current revision');
  if (!/^[0-9a-f]{40}$/.test(currentVersion)) {
    throw new Error('Revision history index: current revision has an invalid version SHA.');
  }
  if (!notes || typeof notes !== 'object') {
    throw new Error('Revision history index: revision notes are missing or malformed.');
  }

  const validated = history.revisions.map((revision, index) => {
    if (!revision || typeof revision !== 'object') {
      throw new Error(
        `Revision history index: revision record ${index + 1} is missing or malformed.`,
      );
    }
    const label = `revision ${revision.n}`;
    const version = scalar(revision.version, `${label} version`);
    const short = scalar(revision.short, `${label} short SHA`);
    if (!/^[0-9a-f]{40}$/.test(version)) {
      throw new Error(`Revision history index: ${label} has an invalid version SHA.`);
    }
    const committedAt = utcTimestamp(revision.committed_at, `${label} timestamp`);
    const file = scalar(revision.file, `${label} snapshot file`);
    const bytes = metric(revision.bytes, `${label} bytes`);
    const lines = metric(revision.lines, `${label} lines`);
    const additions = metric(revision.additions, `${label} additions`);
    const deletions = metric(revision.deletions, `${label} deletions`);
    const total = metric(revision.total, `${label} total changes`);
    if (bytes === 0 || lines === 0) {
      throw new Error(`Revision history index: ${label} has a blank metric.`);
    }
    if (total !== additions + deletions) {
      throw new Error(`Revision history index: ${label} change metrics do not add up.`);
    }
    const expectedFile = `history/${String(revision.n).padStart(2, '0')}-${short}.md`;
    if (file !== expectedFile) {
      throw new Error(`Revision history index: ${label} has an invalid snapshot path.`);
    }
    const note = scalar(notes[version], `${label} note`);
    scalar(revision.url, `revision ${revision.n} GitHub URL`);
    const githubUrl = historyRevisionGithubUrl(revision);
    return {
      revision,
      version,
      committedAt,
      bytes,
      lines,
      additions,
      deletions,
      note,
      githubUrl,
      isCurrent: version === currentVersion,
    };
  });

  if (firstCommittedAt !== validated[0]!.committedAt) {
    throw new Error(
      'Revision history index: first committed timestamp does not match revision 1.',
    );
  }
  if (lastCommittedAt !== validated.at(-1)!.committedAt) {
    throw new Error(
      `Revision history index: last committed timestamp does not match revision ${HISTORY_INDEX_REVISION_COUNT}.`,
    );
  }
  for (let index = 1; index < validated.length; index += 1) {
    if (
      Date.parse(validated[index - 1]!.committedAt) >
      Date.parse(validated[index]!.committedAt)
    ) {
      throw new Error(
        'Revision history index: revision timestamps are out of chronological order.',
      );
    }
  }
  const currentCount = validated.filter((revision) => revision.isCurrent).length;
  if (currentCount !== 1) {
    throw new Error(
      `Revision history index: expected exactly one current revision, found ${currentCount}.`,
    );
  }
  const additionsTotal = validated.reduce(
    (total, revision) => total + revision.additions,
    0,
  );
  const deletionsTotal = validated.reduce(
    (total, revision) => total + revision.deletions,
    0,
  );
  if (
    additionsTotal !== history.additions_total ||
    deletionsTotal !== history.deletions_total
  ) {
    throw new Error(
      'Revision history index: aggregate change metrics do not match the revision records.',
    );
  }

  assertHistorySnapshotCoverage(history, snapshots);
  return { count, firstCommittedAt, lastCommittedAt, revisions: validated };
};

export const serializeHistoryIndex = (source: HistoryIndexSource): string => {
  const validated = validateSource(source);
  const introduction =
    `This index contains exactly ${validated.count} revisions from ` +
    `${validated.firstCommittedAt.slice(0, 10)} through ` +
    `${validated.lastCommittedAt.slice(0, 10)} (UTC).`;
  const entries = validated.revisions.map(
    ({
      revision,
      committedAt,
      bytes,
      lines,
      additions,
      deletions,
      note,
      githubUrl,
      isCurrent,
    }) =>
      [
        `## Revision ${revision.n}`,
        ...(isCurrent ? ['Current example revision'] : []),
        `- UTC date: ${committedAt}`,
        `- Note: ${note}`,
        `- Bytes: ${bytes}`,
        `- Lines: ${lines}`,
        `- Additions: ${additions}`,
        `- Deletions: ${deletions}`,
        `- Revision page: ${historyRevisionPublicUrl(revision)}`,
        `- GitHub revision: ${githubUrl}`,
        `- Markdown snapshot: ${historyRevisionMarkdownUrl(revision)}`,
      ].join('\n'),
  );

  return [
    '# Example PRD revision history',
    introduction,
    ...entries,
  ].join('\n\n') + '\n';
};

export const createHistoryIndexResponse = (
  source: HistoryIndexSource,
): Response =>
  new Response(serializeHistoryIndex(source), {
    status: 200,
    headers: {
      'Content-Type': HISTORY_INDEX_DOWNLOAD.mime,
      'Content-Disposition':
        `attachment; filename="${HISTORY_INDEX_DOWNLOAD.filename}"`,
    },
  });
