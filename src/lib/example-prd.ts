import { readFile } from 'node:fs/promises';
import { parsePrdMarkdown } from './prd-import-markdown';
import {
  normalizePrdLineEndings,
  PRD_TEMPLATE_SECTIONS,
  type PrdTemplateState,
} from './prd-template';

const EXAMPLE_SOURCE = new URL(
  '../../content/gist/build-the-urlist.md',
  import.meta.url,
);

// The worked Example predates the 12-section template. Keep its source order and every body line
// while grouping its headings into the canonical model consumed by the existing exporters.
const EXAMPLE_SECTION_GROUPS = [
  ['Mocks'],
  ['Technical specification and checklist'],
  ['Stack and design'],
  ['Product'],
  ['Routes'],
  ['Home page', 'Draft and editor'],
  ['Live metadata', 'Aliases and publication'],
  ['Login and ownership', 'My Lists'],
  ['Delete', 'Public list'],
  ['Theme, responsive UI, and accessibility', 'Storage and security'],
  ['Scripts, tests, and documentation'],
  ['Completion'],
] as const;

const sourceHeadings = EXAMPLE_SECTION_GROUPS.flat();
const canonicalHeadingBySource: ReadonlyMap<string, string | undefined> =
  new Map(
    EXAMPLE_SECTION_GROUPS.flatMap((group, index) =>
      group.map((heading, position) => [
        heading,
        position === 0 && index > 0
          ? PRD_TEMPLATE_SECTIONS[index]!.title
          : undefined,
      ] as const),
    ),
  );

const generationError = (detail: string): Error =>
  new Error(
    `Example download generation failed: content/gist/build-the-urlist.md ${detail}`,
  );

export const canonicalizeExamplePrdMarkdown = (source: string): string => {
  const lines = normalizePrdLineEndings(source).split('\n');
  const titleLine = lines.findIndex((line) => /^#[ \t]+\S/.test(line));
  if (titleLine === -1) {
    throw generationError('could not be parsed (missing-title).');
  }
  if (lines.findIndex((line) => line.trim()) !== titleLine) {
    throw generationError('could not be parsed (preamble-before-title).');
  }

  const headings = lines.flatMap((line) => {
    const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    return match?.[1] ? [match[1]] : [];
  });
  if (
    headings.length !== sourceHeadings.length ||
    headings.some((heading, index) => heading !== sourceHeadings[index])
  ) {
    throw generationError(
      `has an unexpected section sequence; expected ${sourceHeadings.join(' | ')}.`,
    );
  }

  const body = lines.slice(titleLine + 1).flatMap((line) => {
    const match = /^##[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!match?.[1]) return [line];
    const canonicalHeading = canonicalHeadingBySource.get(match[1]);
    return canonicalHeading
      ? [`## ${canonicalHeading}`, '', `### ${match[1]}`]
      : [`### ${match[1]}`];
  });
  const canonical = [
    lines[titleLine]!,
    '',
    `## ${PRD_TEMPLATE_SECTIONS[0]!.title}`,
    ...body,
  ].join('\n');
  return canonical;
};

export const parseExamplePrdMarkdown = (source: string): PrdTemplateState => {
  const parsed = parsePrdMarkdown(canonicalizeExamplePrdMarkdown(source));
  if (parsed.status === 'invalid') {
    const heading = parsed.heading ? `: "${parsed.heading}"` : '';
    throw generationError(`could not be parsed (${parsed.reason}${heading}).`);
  }
  return parsed.state;
};

export const loadExamplePrdState = async (): Promise<PrdTemplateState> =>
  parseExamplePrdMarkdown(await readFile(EXAMPLE_SOURCE, 'utf8'));
