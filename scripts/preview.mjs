#!/usr/bin/env node
import { preview } from 'astro';
import { fileURLToPath } from 'node:url';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function portFrom(argv) {
  const index = argv.indexOf('--port');
  const value = index >= 0 ? argv[index + 1] : undefined;
  const port = Number(value ?? 4411);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid preview port: ${value ?? ''}`);
  }
  return port;
}

try {
  const server = await preview({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { port: portFrom(process.argv.slice(2)) },
  });
  const httpServer = server.server;
  if (!httpServer) throw new Error('Astro did not expose its preview HTTP server.');

  // Vite's MIME table omits OOXML. Set the header before its static handler runs;
  // GitHub Pages already serves .docx with this registered media type.
  httpServer.prependListener('request', (request, response) => {
    if (request.url?.split('?', 1)[0]?.endsWith('.docx')) {
      response.setHeader('Content-Type', DOCX_MIME);
    }
  });
} catch (error) {
  console.error(`preview: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
