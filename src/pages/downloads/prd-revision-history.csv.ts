import type { APIRoute } from 'astro';
import history from '../../../content/gist/history.json';
import meta from '../../../content/gist/meta.json';
import {
  createHistoryCsvResponse,
  type HistoryCsvSource,
} from '../../lib/history-csv-download';

export const prerender = true;

export const historyCsvSource: HistoryCsvSource = {
  history,
  current: meta,
};

export const createPrdRevisionHistoryCsvResponse = () =>
  createHistoryCsvResponse(historyCsvSource);

export const GET = createPrdRevisionHistoryCsvResponse satisfies APIRoute;
