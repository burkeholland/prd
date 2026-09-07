import { PRD_EDITOR_BACKUP_MAX_BYTES } from './prd-editor-state';
import { markdownHeadings } from './prd-export-document';
import {
  createBlankPrdTemplateState,
  normalizePrdLineEndings,
  normalizePrdSectionValue,
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateState,
} from './prd-template';

export const PRD_MARKDOWN_IMPORT_MAX_BYTES = PRD_EDITOR_BACKUP_MAX_BYTES;

export type PrdMarkdownInvalidReason =
  | 'missing-title'
  | 'multiple-titles'
  | 'preamble-before-title'
  | 'empty-title'
  | 'unknown-section'
  | 'duplicate-section'
  | 'out-of-order-section'
  | 'content-before-section'
  | 'no-sections';

export type ParsedPrdMarkdown =
  | { readonly status: 'valid'; readonly state: PrdTemplateState }
  | {
      readonly status: 'invalid';
      readonly reason: PrdMarkdownInvalidReason;
      readonly heading?: string;
    };

export type ReadPrdMarkdownFile =
  | ParsedPrdMarkdown
  | { readonly status: 'too-large' }
  | { readonly status: 'unsupported-file' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'invalid-utf8' };

export const parsePrdMarkdown = (source: string): ParsedPrdMarkdown => {
  const normalized = normalizePrdLineEndings(source).replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  const headings = markdownHeadings(lines);
  const titles = headings.filter((heading) => heading.level === 1);
  const firstNonblankLine = lines.findIndex((line) => line.trim().length > 0);

  if (titles.length === 0) return { status: 'invalid', reason: 'missing-title' };
  if (firstNonblankLine !== titles[0]?.line) {
    return { status: 'invalid', reason: 'preamble-before-title' };
  }
  if (titles.length !== 1) {
    return { status: 'invalid', reason: 'multiple-titles' };
  }

  const title = titles[0]?.title ?? '';
  if (!title) return { status: 'invalid', reason: 'empty-title' };

  const sectionHeadings = headings.filter((heading) => heading.level === 2);
  const sectionIndexes = new Map<string, number>(
    PRD_TEMPLATE_SECTIONS.map((section, index) => [section.title, index]),
  );
  const seen = new Set<number>();
  let previousIndex = -1;

  for (const heading of sectionHeadings) {
    const index = sectionIndexes.get(heading.title);
    if (index === undefined) {
      return {
        status: 'invalid',
        reason: 'unknown-section',
        heading: heading.title,
      };
    }
    if (seen.has(index)) {
      return {
        status: 'invalid',
        reason: 'duplicate-section',
        heading: heading.title,
      };
    }
    if (index < previousIndex) {
      return {
        status: 'invalid',
        reason: 'out-of-order-section',
        heading: heading.title,
      };
    }
    seen.add(index);
    previousIndex = index;
  }

  const firstSectionLine = sectionHeadings[0]?.line ?? lines.length;
  const preSectionBody = lines
    .slice((titles[0]?.line ?? 0) + 1, firstSectionLine)
    .join('\n')
    .trim();
  if (preSectionBody) {
    return {
      status: 'invalid',
      reason: sectionHeadings.length === 0
        ? 'no-sections'
        : 'content-before-section',
    };
  }

  const blank = createBlankPrdTemplateState(title);
  if (sectionHeadings.length === 0) return { status: 'valid', state: blank };

  const values = { ...blank.values };
  for (const [position, heading] of sectionHeadings.entries()) {
    const sectionIndex = sectionIndexes.get(heading.title);
    if (sectionIndex === undefined) continue;
    const section = PRD_TEMPLATE_SECTIONS[sectionIndex];
    const nextLine = sectionHeadings[position + 1]?.line ?? lines.length;
    values[section.id] = normalizePrdSectionValue(
      lines.slice(heading.line + 1, nextLine).join('\n'),
    );
  }

  return { status: 'valid', state: { title, values } };
};

const supportsMarkdownFile = (file: Pick<File, 'name' | 'type'>): boolean => {
  const mediaType = file.type.toLocaleLowerCase('en-US').split(';', 1)[0]?.trim();
  return file.name.toLocaleLowerCase('en-US').endsWith('.md') ||
    mediaType === 'text/markdown' ||
    mediaType === 'text/plain';
};

export const readPrdMarkdownFile = async (
  file: Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'>,
): Promise<ReadPrdMarkdownFile> => {
  if (file.size > PRD_MARKDOWN_IMPORT_MAX_BYTES) return { status: 'too-large' };
  if (!supportsMarkdownFile(file)) return { status: 'unsupported-file' };

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { status: 'unreadable' };
  }

  let markdown: string;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { status: 'invalid-utf8' };
  }
  return parsePrdMarkdown(markdown);
};
