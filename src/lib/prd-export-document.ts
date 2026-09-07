import {
  normalizePrdLineEndings,
  normalizePrdSectionValue,
} from './prd-template';

export interface PrdExportDocumentSection {
  readonly title: string;
  readonly body: string;
}

export interface PrdExportDocument {
  readonly title: string;
  readonly preamble?: string;
  readonly sections: readonly PrdExportDocumentSection[];
}

export interface MarkdownHeading {
  readonly level: number;
  readonly title: string;
  readonly line: number;
}

export interface MarkdownStructure {
  readonly headings: readonly MarkdownHeading[];
  readonly unclosedFence: boolean;
}

export const scanMarkdownStructure = (
  lines: readonly string[],
): MarkdownStructure => {
  const headings: MarkdownHeading[] = [];
  let fence: { marker: '`' | '~'; length: number } | undefined;

  for (const [line, value] of lines.entries()) {
    if (fence) {
      const closing = value.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
      if (
        closing &&
        closing[1]?.[0] === fence.marker &&
        closing[1].length >= fence.length
      ) {
        fence = undefined;
      }
      continue;
    }

    const opening = value.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (opening?.[1]) {
      fence = {
        marker: opening[1][0] as '`' | '~',
        length: opening[1].length,
      };
      continue;
    }

    const heading = value.match(/^(#{1,6})[ \t]+(.*)$/);
    if (heading?.[1] && heading[2] !== undefined) {
      headings.push({
        level: heading[1].length,
        title: heading[2].trim(),
        line,
      });
    }
  }

  return { headings, unclosedFence: fence !== undefined };
};

export const markdownHeadings = (
  lines: readonly string[],
): readonly MarkdownHeading[] => scanMarkdownStructure(lines).headings;

export type PrdExportMarkdownInvalidReason =
  | 'missing-title'
  | 'multiple-titles'
  | 'content-before-title'
  | 'empty-title'
  | 'missing-sections'
  | 'empty-section-title'
  | 'unclosed-fence';

export type ParsedPrdExportMarkdown =
  | { readonly status: 'valid'; readonly document: PrdExportDocument }
  | {
      readonly status: 'invalid';
      readonly reason: PrdExportMarkdownInvalidReason;
    };

export const parsePrdExportMarkdown = (
  source: string,
): ParsedPrdExportMarkdown => {
  const normalized = normalizePrdLineEndings(source).replace(/^\uFEFF/, '');
  const lines = normalized.split('\n');
  const structure = scanMarkdownStructure(lines);
  if (structure.unclosedFence) {
    return { status: 'invalid', reason: 'unclosed-fence' };
  }

  const titles = structure.headings.filter((heading) => heading.level === 1);
  if (titles.length === 0) return { status: 'invalid', reason: 'missing-title' };
  if (titles.length !== 1) {
    return { status: 'invalid', reason: 'multiple-titles' };
  }

  const title = titles[0]!;
  if (lines.findIndex((line) => line.trim().length > 0) !== title.line) {
    return { status: 'invalid', reason: 'content-before-title' };
  }
  if (!title.title) return { status: 'invalid', reason: 'empty-title' };

  const sectionHeadings = structure.headings.filter(
    (heading) => heading.level === 2,
  );
  if (sectionHeadings.length === 0) {
    return { status: 'invalid', reason: 'missing-sections' };
  }
  if (sectionHeadings.some((heading) => !heading.title)) {
    return { status: 'invalid', reason: 'empty-section-title' };
  }

  const preamble = normalizePrdSectionValue(
    lines.slice(title.line + 1, sectionHeadings[0]!.line).join('\n'),
  );
  const sections = sectionHeadings.map((heading, index) => ({
    title: heading.title,
    body: normalizePrdSectionValue(
      lines
        .slice(
          heading.line + 1,
          sectionHeadings[index + 1]?.line ?? lines.length,
        )
        .join('\n'),
    ),
  }));

  return {
    status: 'valid',
    document: { title: title.title, preamble, sections },
  };
};
