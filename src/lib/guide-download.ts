export const GUIDE_DOWNLOAD_PATH = '/downloads/prd-guide.md';
export const GUIDE_DOWNLOAD_FILENAME = 'prd-guide.md';
export const GUIDE_MARKDOWN_MIME = 'text/markdown; charset=utf-8';

export interface GuideDownloadEntry {
  data?: {
    title?: unknown;
    description?: unknown;
  };
  body?: unknown;
}

const FRONTMATTER_ENVELOPE =
  /^\uFEFF?---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const QUOTE_VALIDATOR_LINE =
  /^[\t ]*<!--[\t ]*quote:[\t ]*not-gist[\t ]*-->[\t ]*(?:\n|$)/gim;
const COMPATIBILITY_VALIDATOR_COMMENT =
  /^[\t ]*<!--[\t ]*Compatibility headings keep the link checker aligned with the rendered aliases above\.[\t ]*\n[\s\S]*?^[\t ]*-->[\t ]*(?:\n|$)/gim;
const SOURCE_VALIDATOR_MARKER =
  /<!--[\t ]*(?:quote[\t ]*:|Compatibility headings keep the link checker aligned)/i;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`guide download: content entry ${field} is required`);
  }
  return value.replace(/\r\n?/g, '\n');
};

export function assertGuideDownloadSource(source: unknown): asserts source is string {
  const normalized = requiredText(source, 'source');
  if (!FRONTMATTER_ENVELOPE.test(normalized)) {
    throw new Error('guide download: source frontmatter is malformed');
  }
}

export function serializeGuideMarkdown(
  entry: GuideDownloadEntry | null | undefined,
): string {
  if (!entry) {
    throw new Error('guide download: content entry is required');
  }

  const title = requiredText(entry.data?.title, 'title');
  if (title.includes('\n')) {
    throw new Error('guide download: content entry title must be one line');
  }
  const description = requiredText(entry.data?.description, 'description');
  const body = requiredText(entry.body, 'body')
    .replace(QUOTE_VALIDATOR_LINE, '')
    .replace(COMPATIBILITY_VALIDATOR_COMMENT, '')
    .replace(/^\n+|\n+$/g, '');

  if (body.trim() === '') {
    throw new Error('guide download: content entry body is required');
  }

  const markdown = `# ${title}\n\n${description}\n\n${body}\n`;
  if (SOURCE_VALIDATOR_MARKER.test(markdown)) {
    throw new Error('guide download: source-only validator marker remains');
  }
  return markdown;
}

export function createGuideMarkdownResponse(
  entry: GuideDownloadEntry | null | undefined,
): Response {
  const bytes = new TextEncoder().encode(serializeGuideMarkdown(entry));
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': GUIDE_MARKDOWN_MIME,
      'Content-Disposition': `attachment; filename="${GUIDE_DOWNLOAD_FILENAME}"`,
    },
  });
}
