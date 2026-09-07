import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRoute } from 'astro';
import history from '../../../content/gist/history.json';
import {
  assertHistorySnapshotCoverage,
  HISTORY_MARKDOWN_MIME,
  historyDownloadFilename,
  historyDownloadStem,
} from '../../lib/history-downloads';

export const prerender = true;

const gistDirectory = fileURLToPath(new URL('../../../content/gist/', import.meta.url));
const historyDirectory = fileURLToPath(new URL('../../../content/gist/history/', import.meta.url));
const snapshots = Object.fromEntries(
  readdirSync(historyDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const file = `history/${entry.name}`;
      return [file, readFileSync(join(historyDirectory, entry.name))];
    }),
);

assertHistorySnapshotCoverage(history, snapshots);

const revisionByStem = new Map(
  history.revisions.map((revision) => [historyDownloadStem(revision), revision]),
);

export function getStaticPaths() {
  return history.revisions.map((revision) => ({
    params: { download: historyDownloadStem(revision) },
  }));
}

export const GET: APIRoute = ({ params }) => {
  const revision = revisionByStem.get(params.download ?? '');
  if (!revision) throw new Error(`history downloads: no revision for ${params.download ?? ''}`);

  const bytes = readFileSync(join(gistDirectory, ...revision.file.split('/')));
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': HISTORY_MARKDOWN_MIME,
      'Content-Disposition': `attachment; filename="${historyDownloadFilename(revision)}"`,
    },
  });
};
