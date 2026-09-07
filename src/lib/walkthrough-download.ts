export const WALKTHROUGH_DOWNLOAD_PATH = '/downloads/prd-example-walkthrough.md';
export const WALKTHROUGH_DOWNLOAD_FILENAME = 'prd-example-walkthrough.md';
export const WALKTHROUGH_MARKDOWN_MIME = 'text/markdown; charset=utf-8';

export interface WalkthroughDownloadEntry {
  data?: {
    title?: unknown;
    description?: unknown;
  };
  body?: unknown;
}

const SOURCE_VALIDATOR_LINE =
  /^[\t ]*<!--[\t ]*quote:[\t ]*not-gist[\t ]*-->[\t ]*(?:\n|$)/gim;
const SOURCE_VALIDATOR_MARKER = /<!--[\t ]*quote[\t ]*:/i;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`walkthrough download: content entry ${field} is required`);
  }
  return value.replace(/\r\n?/g, '\n');
};

export function serializeWalkthroughMarkdown(
  entry: WalkthroughDownloadEntry | null | undefined,
): string {
  if (!entry) {
    throw new Error('walkthrough download: content entry is required');
  }

  const title = requiredText(entry.data?.title, 'title');
  if (title.includes('\n')) {
    throw new Error('walkthrough download: content entry title must be one line');
  }
  const description = requiredText(entry.data?.description, 'description');
  const body = requiredText(entry.body, 'body')
    .replace(SOURCE_VALIDATOR_LINE, '')
    .replace(/^\n+|\n+$/g, '');

  if (body.trim() === '') {
    throw new Error('walkthrough download: content entry body is required');
  }

  const markdown = `# ${title}\n\n${description}\n\n${body}\n`;
  if (SOURCE_VALIDATOR_MARKER.test(markdown)) {
    throw new Error('walkthrough download: source-only validator marker remains');
  }
  return markdown;
}

export function createWalkthroughMarkdownResponse(
  entry: WalkthroughDownloadEntry | null | undefined,
): Response {
  const bytes = new TextEncoder().encode(serializeWalkthroughMarkdown(entry));
  return new Response(bytes, {
    headers: {
      'Content-Type': WALKTHROUGH_MARKDOWN_MIME,
      'Content-Disposition': `attachment; filename="${WALKTHROUGH_DOWNLOAD_FILENAME}"`,
    },
  });
}
