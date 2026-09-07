import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseTemplateGuideSource,
  serializeTemplateGuideMarkdown,
  templateGuideMarkdownBytes,
} from '../../src/lib/template-guide';
import {
  createPrdTemplateGuideMarkdownResponse,
  TEMPLATE_GUIDE_FILENAME,
  TEMPLATE_GUIDE_MIME_TYPE,
} from '../../src/pages/downloads/prd-template-guide.md';

const SOURCE_PATH = resolve('content/template.md');
const decoder = new TextDecoder('utf-8', { fatal: true });

const sourceBodyWithoutComments = (source: string): string => {
  const normalized = source.replace(/\r\n?/g, '\n');
  const closing = normalized.indexOf('\n---\n', 4);
  if (closing === -1) throw new Error('Expected the fixture to have frontmatter.');
  return normalized
    .slice(closing + 5)
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
};

describe('Template guide Markdown serialization', () => {
  it('emits the exact source title, description, and complete body in order', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const parsed = parseTemplateGuideSource(source);
    const markdown = serializeTemplateGuideMarkdown(source);
    const expectedBody = sourceBodyWithoutComments(source);

    expect(parsed).toEqual({
      title: 'PRD template',
      description:
        "The editor's adaptable PRD template, with prompts and blank sections to copy or download.",
      body: expectedBody,
    });
    expect(markdown).toBe(
      `# ${parsed.title}\n\n${parsed.description}\n\n${expectedBody}\n`,
    );
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown).not.toContain('---');
    expect(markdown).not.toContain('<!--');
    expect(markdown).not.toContain('-->');
  });

  it('preserves Markdown constructs, normalizes CRLF, removes only out-of-fence source comments, and writes one terminal LF', () => {
    const source = [
      '---',
      'title: "Portable guide"',
      'description: "Opening description."',
      'order: 4',
      '---',
      '',
      '<!-- source-only validator note -->',
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
      '<!-- authored fenced example -->',
      '# Example',
      '```',
      '',
    ].join('\r\n');
    const expected = [
      '# Portable guide',
      '',
      'Opening description.',
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
      '<!-- authored fenced example -->',
      '# Example',
      '```',
      '',
    ].join('\n');

    const markdown = serializeTemplateGuideMarkdown(source);
    expect(markdown).toBe(expected);
    expect(decoder.decode(templateGuideMarkdownBytes(source))).toBe(expected);
    expect(markdown).not.toContain('\r');
    expect(markdown.match(/\n+$/)?.[0]).toBe('\n');
  });

  it.each([
    ['absent source', '', 'is absent'],
    ['missing frontmatter', '# Title\n\nBody', 'has malformed frontmatter'],
    ['unclosed frontmatter', '---\ntitle: "Title"\n', 'has malformed frontmatter'],
    [
      'malformed frontmatter entry',
      '---\ntitle: "Title"\nnot an entry\n---\nBody',
      'has malformed frontmatter',
    ],
    [
      'missing title',
      '---\ndescription: "Description"\n---\nBody',
      'has no title',
    ],
    [
      'missing description',
      '---\ntitle: "Title"\n---\nBody',
      'has no description',
    ],
    [
      'missing body',
      '---\ntitle: "Title"\ndescription: "Description"\n---\n<!-- marker -->',
      'has no body',
    ],
    [
      'unclosed validator marker',
      '---\ntitle: "Title"\ndescription: "Description"\n---\n<!-- marker\nBody',
      'still contains a source-only validator marker',
    ],
  ])('fails explicitly for %s', (_label, source, reason) => {
    expect(() => serializeTemplateGuideMarkdown(source)).toThrow(
      `Template guide generation failed: content/template.md ${reason}`,
    );
  });
});

describe('prerendered Template guide response', () => {
  it('returns the same deterministic non-empty UTF-8 attachment twice', async () => {
    const source = await readFile(SOURCE_PATH, 'utf8');
    const expected = templateGuideMarkdownBytes(source);
    const first = await createPrdTemplateGuideMarkdownResponse();
    const second = await createPrdTemplateGuideMarkdownResponse();
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(TEMPLATE_GUIDE_MIME_TYPE);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${TEMPLATE_GUIDE_FILENAME}"`,
    );
    expect(firstBytes.byteLength).toBeGreaterThan(0);
    expect(decoder.decode(firstBytes)).toBe(serializeTemplateGuideMarkdown(source));
    expect(firstBytes).toEqual(expected);
    expect(secondBytes).toEqual(firstBytes);
    expect(firstBytes.at(-1)).toBe(0x0a);
    expect(firstBytes.at(-2)).not.toBe(0x0a);
  });
});
