import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const TEMPLATE_GUIDE_SOURCE = resolve('content/template.md');
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const HTML_COMMENT_MARKER_RE = /<!--|-->/;

const generationError = (reason: string): Error =>
  new Error(
    `Template guide generation failed: content/template.md ${reason}`,
  );

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n?/g, '\n');

const parseScalar = (raw: string): string => {
  const value = raw.trim();
  if (value === '') return '';

  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // The shared malformed-frontmatter error below is more useful than JSON syntax details.
    }
    throw generationError('has malformed frontmatter.');
  }

  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) {
      throw generationError('has malformed frontmatter.');
    }
    const inner = value.slice(1, -1);
    if (/(^|[^'])'(?!')/.test(inner)) {
      throw generationError('has malformed frontmatter.');
    }
    return inner.replace(/''/g, "'");
  }

  if (value.endsWith('"') || value.endsWith("'")) {
    throw generationError('has malformed frontmatter.');
  }
  return value;
};

const transformOutsideFences = (
  source: string,
  transform: (segment: string) => string,
): string => {
  const output: string[] = [];
  let plain = '';
  let fence: { character: string; length: number } | undefined;

  for (const line of source.match(/[^\n]*(?:\n|$)/g) ?? []) {
    if (line === '') continue;
    const content = line.endsWith('\n') ? line.slice(0, -1) : line;

    if (fence) {
      output.push(line);
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(content);
      if (
        closing &&
        closing[1]![0] === fence.character &&
        closing[1]!.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = FENCE_RE.exec(content);
    if (opening) {
      output.push(transform(plain), line);
      plain = '';
      fence = {
        character: opening[1]![0]!,
        length: opening[1]!.length,
      };
      continue;
    }

    plain += line;
  }

  output.push(transform(plain));
  return output.join('');
};

const trimBlankEdgeLines = (value: string): string =>
  value
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');

export interface TemplateGuideSource {
  readonly title: string;
  readonly description: string;
  readonly body: string;
}

export const parseTemplateGuideSource = (
  source: string,
): TemplateGuideSource => {
  if (typeof source !== 'string' || source.trim() === '') {
    throw generationError('is absent.');
  }

  const normalized = normalizeLineEndings(source).replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) {
    throw generationError('has malformed frontmatter.');
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && /^---[ \t]*$/.test(line),
  );
  if (closingIndex === -1) {
    throw generationError('has malformed frontmatter.');
  }

  const data = new Map<string, string>();
  for (const line of lines.slice(1, closingIndex)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const entry = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]*(.*))?$/.exec(line);
    if (!entry || data.has(entry[1]!)) {
      throw generationError('has malformed frontmatter.');
    }
    data.set(entry[1]!, parseScalar(entry[2] ?? ''));
  }

  const title = data.get('title');
  if (!title?.trim()) throw generationError('has no title.');
  if (title.includes('\n')) throw generationError('has malformed frontmatter.');

  const description = data.get('description');
  if (!description?.trim()) throw generationError('has no description.');
  if (description.includes('\n')) {
    throw generationError('has malformed frontmatter.');
  }

  const withoutSourceComments = transformOutsideFences(
    lines.slice(closingIndex + 1).join('\n'),
    (segment) => segment.replace(HTML_COMMENT_RE, ''),
  );
  let markerRemains = false;
  transformOutsideFences(withoutSourceComments, (segment) => {
    markerRemains ||= HTML_COMMENT_MARKER_RE.test(segment);
    return segment;
  });
  if (markerRemains) {
    throw generationError('still contains a source-only validator marker.');
  }

  const body = trimBlankEdgeLines(withoutSourceComments);
  if (body.trim() === '') throw generationError('has no body.');

  return { title, description, body };
};

export const serializeTemplateGuideMarkdown = (source: string): string => {
  const { title, description, body } = parseTemplateGuideSource(source);
  return `# ${title}\n\n${description}\n\n${body}\n`;
};

export const templateGuideMarkdownBytes = (source: string): Uint8Array =>
  new TextEncoder().encode(serializeTemplateGuideMarkdown(source));

export const loadTemplateGuideMarkdownBytes = async (): Promise<Uint8Array> => {
  try {
    return templateGuideMarkdownBytes(
      await readFile(TEMPLATE_GUIDE_SOURCE, 'utf8'),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      throw generationError('is absent.');
    }
    throw error;
  }
};
