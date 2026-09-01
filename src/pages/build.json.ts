import type { APIRoute } from 'astro';
import { buildStamp } from '../lib/build-stamp';

// Prerendered into dist/build.json (output: 'static'), so the stamp is the build's, not a
// request's: the deploy job compares its `sha` with the commit it just published (deploy.yml).
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildStamp(process.env, new Date()), null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json' },
  });
