import {
  PRD_TEMPLATE,
  serializeBlankPrdMarkdown,
} from './prd-template';

export const TEMPLATE_GUIDE_DOWNLOAD_PATH = '/downloads/prd-template-guide.md';
export const TEMPLATE_GUIDE_DOWNLOAD_FILENAME = 'prd-template-guide.md';
export const TEMPLATE_GUIDE_MARKDOWN_MIME = 'text/markdown; charset=utf-8';
export const TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE =
  'Replace the placeholders you keep with your own decisions.';

export interface TemplateGuideDownloadEntry {
  data?: {
    title?: unknown;
    description?: unknown;
  };
  body?: unknown;
}

const SOURCE_ONLY_INTRODUCTION_COMMENT =
  '<!-- Introduction and metadata only. Sections come from src/lib/prd-template.ts in template.astro. -->';
const SOURCE_ONLY_INTRODUCTION_MARKER =
  '<!-- Introduction and metadata only.';
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`template guide download: content entry ${field} is required`);
  }
  return value.replace(/\r\n?/g, '\n');
};

const cleanAuthoredBody = (value: unknown): string => {
  const lines = requiredText(value, 'body').split('\n');
  const output: string[] = [];
  let fence: { character: string; length: number } | undefined;
  let sourceMarkerRemains = false;

  for (const line of lines) {
    if (fence) {
      output.push(line);
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (
        closing &&
        closing[1]![0] === fence.character &&
        closing[1]!.length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = FENCE_OPEN_RE.exec(line);
    if (opening) {
      fence = {
        character: opening[1]![0]!,
        length: opening[1]!.length,
      };
      output.push(line);
      continue;
    }

    if (line.trim() === SOURCE_ONLY_INTRODUCTION_COMMENT) continue;
    if (line.includes(SOURCE_ONLY_INTRODUCTION_MARKER)) {
      sourceMarkerRemains = true;
    }
    output.push(line);
  }

  if (sourceMarkerRemains) {
    throw new Error('template guide download: source-only validator marker remains');
  }

  const body = output.join('\n').replace(/^\n+|\n+$/g, '');
  if (body.trim() === '') {
    throw new Error('template guide download: content entry body is required');
  }
  return body;
};

export const getBlankTemplateSectionMarkdownExamples = (): readonly string[] => {
  const sections = serializeBlankPrdMarkdown()
    .split(/(?=^## )/m)
    .slice(1)
    .map((section) => section.trimEnd());

  if (sections.length !== PRD_TEMPLATE.sections.length) {
    throw new Error('template guide download: blank section examples are incomplete');
  }
  return sections;
};

export function serializeTemplateGuideMarkdown(
  entry: TemplateGuideDownloadEntry | null | undefined,
): string {
  if (!entry) {
    throw new Error('template guide download: content entry is required');
  }

  const title = requiredText(entry.data?.title, 'title');
  if (title.includes('\n')) {
    throw new Error('template guide download: content entry title must be one line');
  }
  const description = requiredText(entry.data?.description, 'description');
  const body = cleanAuthoredBody(entry.body);
  const blankExamples = getBlankTemplateSectionMarkdownExamples();
  const guidance =
    `${PRD_TEMPLATE.guidance} ${TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE}`;
  const sections = PRD_TEMPLATE.sections.map((section, index) => {
    if (section.helperQuestions.length !== 2) {
      throw new Error(
        `template guide download: ${section.id} must have exactly two helper questions`,
      );
    }

    return [
      `## ${section.title}`,
      '',
      section.prompt,
      '',
      ...section.helperQuestions.map((question) => `- ${question}`),
      '',
      '```markdown',
      blankExamples[index]!,
      '```',
    ].join('\n');
  }).join('\n\n');

  return [
    `# ${title}`,
    '',
    description,
    '',
    body,
    '',
    guidance,
    '',
    sections,
    '',
  ].join('\n');
}

export function createTemplateGuideMarkdownResponse(
  entry: TemplateGuideDownloadEntry | null | undefined,
): Response {
  const bytes = new TextEncoder().encode(serializeTemplateGuideMarkdown(entry));
  return new Response(bytes, {
    headers: {
      'Content-Type': TEMPLATE_GUIDE_MARKDOWN_MIME,
      'Content-Disposition':
        `attachment; filename="${TEMPLATE_GUIDE_DOWNLOAD_FILENAME}"`,
    },
  });
}
