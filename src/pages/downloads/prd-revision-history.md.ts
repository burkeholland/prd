import type { APIRoute } from 'astro';
import history from '../../../content/gist/history.json';
import meta from '../../../content/gist/meta.json';
import {
  createHistoryIndexResponse,
  type HistoryIndexSource,
} from '../../lib/history-index-download';
import { NOTES } from '../../lib/history-notes';

export const prerender = true;

const files = import.meta.glob<string>('../../../content/gist/history/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const snapshots = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [
    `history/${path.split('/').pop()}`,
    text,
  ]),
);

export const historyIndexSource: HistoryIndexSource = {
  history,
  snapshots,
  current: meta,
  notes: NOTES,
};

export const createPrdRevisionHistoryResponse = () =>
  createHistoryIndexResponse(historyIndexSource);

export const GET = createPrdRevisionHistoryResponse satisfies APIRoute;
