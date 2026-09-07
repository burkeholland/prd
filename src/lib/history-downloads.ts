import type { HistoryDocument, HistoryRevision } from './history';

export const HISTORY_MARKDOWN_MIME = 'text/markdown;charset=utf-8';

type DownloadRevision = Pick<HistoryRevision, 'n' | 'short'>;
type Snapshot = string | Uint8Array;

export function historyDownloadStem(revision: DownloadRevision): string {
  return `revision-${revision.n}-${revision.short}`;
}

export function historyDownloadPath(revision: DownloadRevision): string {
  return `/history/${historyDownloadStem(revision)}.md`;
}

export function historyDownloadFilename(revision: DownloadRevision): string {
  return `build-the-urlist-${historyDownloadStem(revision)}.md`;
}

const byteLength = (snapshot: Snapshot) =>
  typeof snapshot === 'string' ? new TextEncoder().encode(snapshot).byteLength : snapshot.byteLength;

/**
 * Keeps generated downloads in lockstep with history.json. The snapshot value is only
 * measured here; endpoint generation serves the original bytes directly.
 */
export function assertHistorySnapshotCoverage(
  history: HistoryDocument,
  snapshots: Record<string, Snapshot>,
): void {
  if (history.count !== history.revisions.length) {
    throw new Error(
      `history downloads: count ${history.count} does not match ${history.revisions.length} revisions`,
    );
  }

  const expectedFiles = history.revisions.map((revision) => revision.file);
  if (new Set(expectedFiles).size !== expectedFiles.length) {
    throw new Error('history downloads: duplicate snapshot file in metadata');
  }

  const actualFiles = Object.keys(snapshots);
  const missing = expectedFiles.filter((file) => !(file in snapshots));
  const extra = actualFiles.filter((file) => !expectedFiles.includes(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `history downloads: snapshot coverage mismatch (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
    );
  }

  const paths = history.revisions.map(historyDownloadPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error('history downloads: duplicate public Markdown URL');
  }

  for (const revision of history.revisions) {
    if (revision.short !== revision.version.slice(0, 7) || !/^[0-9a-f]{7}$/.test(revision.short)) {
      throw new Error(`history downloads: invalid short SHA for revision ${revision.n}`);
    }
    const actualBytes = byteLength(snapshots[revision.file]!);
    if (actualBytes !== revision.bytes) {
      throw new Error(
        `history downloads: ${revision.file} is ${actualBytes} bytes, metadata records ${revision.bytes}`,
      );
    }
  }
}
