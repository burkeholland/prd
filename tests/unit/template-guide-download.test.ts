import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractHeadings,
  parseFrontmatter,
} from '../../scripts/lib/content.mjs';
import {
  createTemplateGuideMarkdownResponse,
  getBlankTemplateSectionMarkdownExamples,
  serializeTemplateGuideMarkdown,
  TEMPLATE_GUIDE_DOWNLOAD_FILENAME,
  TEMPLATE_GUIDE_MARKDOWN_MIME,
  TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE,
  type TemplateGuideDownloadEntry,
} from '../../src/lib/template-guide';
import { PRD_TEMPLATE } from '../../src/lib/prd-template';

const source = readFileSync(resolve('content/template.md'), 'utf8');
const parsed = parseFrontmatter(source);
if (
  !parsed.data ||
  !('title' in parsed.data) ||
  typeof parsed.data.title !== 'string' ||
  !('description' in parsed.data) ||
  typeof parsed.data.description !== 'string'
) {
  throw new Error('template guide fixture requires title and description frontmatter');
}
const { title, description } = parsed.data;
const entry: TemplateGuideDownloadEntry = {
  data: parsed.data,
  body: parsed.body,
};
const sourceOnlyComment =
  '<!-- Introduction and metadata only. Sections come from src/lib/prd-template.ts in template.astro. -->';
const expectedBody = parsed.body
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .filter((line) => line.trim() !== sourceOnlyComment)
  .join('\n')
  .replace(/^\n+|\n+$/g, '');
const blankExamples = getBlankTemplateSectionMarkdownExamples();
const expectedSections = PRD_TEMPLATE.sections.map((section, index) => [
  `## ${section.title}`,
  '',
  section.prompt,
  '',
  ...section.helperQuestions.map((question) => `- ${question}`),
  '',
  '```markdown',
  blankExamples[index],
  '```',
].join('\n'));
const expected = [
  `# ${title}`,
  '',
  description,
  '',
  expectedBody,
  '',
  `${PRD_TEMPLATE.guidance} ${TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE}`,
  '',
  expectedSections.join('\n\n'),
  '',
].join('\n');

describe('Template guide Markdown download', () => {
  it('serializes the complete checked-in introduction and all model-driven guidance in order', () => {
    const markdown = serializeTemplateGuideMarkdown(entry);
    const headings = extractHeadings(markdown);

    expect(markdown).toBe(expected);
    expect(headings.map(({ depth, text }) => ({ depth, text }))).toEqual([
      { depth: 1, text: title },
      ...PRD_TEMPLATE.sections.map(({ title: sectionTitle }) => ({
        depth: 2,
        text: sectionTitle,
      })),
    ]);
    expect(blankExamples).toHaveLength(12);

    let cursor = markdown.indexOf(
      `${PRD_TEMPLATE.guidance} ${TEMPLATE_REPLACE_PLACEHOLDERS_GUIDANCE}`,
    );
    for (const [index, section] of PRD_TEMPLATE.sections.entries()) {
      expect(section.helperQuestions).toHaveLength(2);
      const sectionIndex = markdown.indexOf(expectedSections[index]!, cursor);
      expect(sectionIndex, `${section.id} follows the prior section`).toBeGreaterThan(cursor);
      cursor = sectionIndex + expectedSections[index]!.length;
    }

    expect(markdown).not.toMatch(/^---$/m);
    expect(markdown).not.toContain(sourceOnlyComment);
    expect(markdown).not.toContain('\r');
    expect(markdown).toMatch(/[^\n]\n$/);
    expect(markdown).not.toMatch(/\n\n$/);
  });

  it('preserves authored Markdown and removes only the known marker outside fences', () => {
    const fixture: TemplateGuideDownloadEntry = {
      data: { title: 'Portable guide', description: 'Opening description.' },
      body: [
        '',
        sourceOnlyComment,
        '',
        '## Prompt and example',
        '',
        '> Keep this **emphasis** and [link](/sample).',
        '',
        '| Format | Use |',
        '|---|---|',
        '| Markdown | Source control |',
        '',
        '1. First',
        '2. Second',
        '',
        '```md',
        sourceOnlyComment,
        '# Authored fenced example',
        '```',
        '',
      ].join('\r\n'),
    };
    const markdown = serializeTemplateGuideMarkdown(fixture);

    expect(markdown).toContain('> Keep this **emphasis** and [link](/sample).');
    expect(markdown).toContain('| Markdown | Source control |');
    expect(markdown).toContain('1. First\n2. Second');
    expect(markdown).toContain(
      `\`\`\`md\n${sourceOnlyComment}\n# Authored fenced example\n\`\`\``,
    );
    expect(markdown.match(new RegExp(sourceOnlyComment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it('returns deterministic non-empty UTF-8 bytes and exact attachment metadata twice', async () => {
    const first = createTemplateGuideMarkdownResponse(entry);
    const second = createTemplateGuideMarkdownResponse(entry);
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(TEMPLATE_GUIDE_MARKDOWN_MIME);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${TEMPLATE_GUIDE_DOWNLOAD_FILENAME}"`,
    );
    expect(firstBytes.byteLength).toBeGreaterThan(0);
    expect(secondBytes).toEqual(firstBytes);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(firstBytes)).toBe(expected);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.at(-2)).not.toBe(0x0a);
  });

  it.each([
    ['entry', undefined, 'content entry is required'],
    ['title', { data: { description: 'Description' }, body: 'Body' }, 'title is required'],
    [
      'multiline title',
      { data: { title: 'Title\nextra', description: 'Description' }, body: 'Body' },
      'title must be one line',
    ],
    ['description', { data: { title: 'Title' }, body: 'Body' }, 'description is required'],
    ['body', { data: { title: 'Title', description: 'Description' } }, 'body is required'],
    [
      'body after marker removal',
      {
        data: { title: 'Title', description: 'Description' },
        body: sourceOnlyComment,
      },
      'body is required',
    ],
    [
      'unexpected source marker',
      {
        data: { title: 'Title', description: 'Description' },
        body: '<!-- Introduction and metadata only. Changed marker -->\nBody',
      },
      'source-only validator marker remains',
    ],
  ])('rejects a malformed %s fixture explicitly', (_name, malformed, message) => {
    expect(() => serializeTemplateGuideMarkdown(malformed)).toThrow(message);
    expect(() => createTemplateGuideMarkdownResponse(malformed)).toThrow(message);
  });
});
