import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/lib/content.mjs';
import {
  assertGuideDownloadSource,
  createGuideMarkdownResponse,
  GUIDE_DOWNLOAD_FILENAME,
  GUIDE_MARKDOWN_MIME,
  serializeGuideMarkdown,
  type GuideDownloadEntry,
} from '../../src/lib/guide-download';

const source = readFileSync(resolve('content/guide.md'), 'utf8');
assertGuideDownloadSource(source);
const parsed = parseFrontmatter(source);
if (
  !parsed.data ||
  !('title' in parsed.data) ||
  typeof parsed.data.title !== 'string' ||
  !('description' in parsed.data) ||
  typeof parsed.data.description !== 'string'
) {
  throw new Error('guide fixture requires title and description frontmatter');
}
const { title, description } = parsed.data;

const entry: GuideDownloadEntry = {
  data: parsed.data,
  body: parsed.body,
};
const expectedBody = parsed.body
  .replace(/\r\n?/g, '\n')
  .replace(/^[\t ]*<!--[\t ]*quote:[\t ]*not-gist[\t ]*-->[\t ]*(?:\n|$)/gim, '')
  .replace(
    /^[\t ]*<!--[\t ]*Compatibility headings keep the link checker aligned with the rendered aliases above\.[\t ]*\n[\s\S]*?^[\t ]*-->[\t ]*(?:\n|$)/gim,
    '',
  )
  .replace(/^\n+|\n+$/g, '');
const expected = `# ${title}\n\n${description}\n\n${expectedBody}\n`;

describe('Guide Markdown download', () => {
  it('serializes the complete checked-in entry in exact source order', () => {
    const markdown = serializeGuideMarkdown(entry);

    expect(markdown).toBe(expected);
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown.startsWith(`# ${title}\n\n${description}\n\n`)).toBe(true);
    expect(markdown.match(/^## /gm)).toHaveLength(4);
    expect(markdown.match(/^### /gm)).toHaveLength(7);
    expect(markdown.match(/^- \[ \] /gm)).toHaveLength(7);
    expect(markdown.match(/^> /gm)).toHaveLength(7);
    expect(markdown).toContain('[annotated template](/template)');
    expect(markdown).toContain('`better-sqlite3`');
    expect(markdown).toContain('**Check:**');
    expect(markdown).toContain('| Vague | Specific |');
    expect(markdown).not.toContain('Compatibility headings keep the link checker aligned');
    expect(markdown).not.toMatch(/^---$/m);
    expect(markdown).not.toContain('\r');
    expect(markdown).toMatch(/[^\n]\n$/);
    expect(markdown).not.toMatch(/\n\n$/);
  });

  it('returns deterministic UTF-8 response bytes and exact attachment metadata twice', async () => {
    const first = createGuideMarkdownResponse(entry);
    const second = createGuideMarkdownResponse(entry);
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(GUIDE_MARKDOWN_MIME);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${GUIDE_DOWNLOAD_FILENAME}"`,
    );
    expect(firstBytes.byteLength).toBeGreaterThan(0);
    expect(secondBytes).toEqual(firstBytes);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(firstBytes)).toBe(expected);
  });

  it('normalizes line endings and removes source-only validator comments', () => {
    expect(
      serializeGuideMarkdown({
        data: { title: 'Title', description: 'Opening description.' },
        body:
          '\r\nIntro with *emphasis*.\r\n\r\n' +
          '<!-- Compatibility headings keep the link checker aligned with the rendered aliases above.\r\n' +
          '###### Validator alias\r\n' +
          '-->\r\n\r\n> Quote\r\n',
      }),
    ).toBe('# Title\n\nOpening description.\n\nIntro with *emphasis*.\n\n\n> Quote\n');
  });

  it.each([
    ['source', undefined, 'content entry source is required'],
    ['empty source', '', 'content entry source is required'],
    ['frontmatter', '---\ntitle: Broken\nBody', 'source frontmatter is malformed'],
  ])('rejects malformed %s explicitly', (_name, malformed, message) => {
    expect(() => assertGuideDownloadSource(malformed)).toThrow(message);
  });

  it.each([
    ['entry', undefined, 'content entry is required'],
    ['title', { data: { description: 'Description' }, body: 'Body' }, 'title is required'],
    ['multiline title', { data: { title: 'Title\nTwo', description: 'Description' }, body: 'Body' }, 'title must be one line'],
    ['description', { data: { title: 'Title' }, body: 'Body' }, 'description is required'],
    ['body', { data: { title: 'Title', description: 'Description' } }, 'body is required'],
    [
      'body after marker removal',
      {
        data: { title: 'Title', description: 'Description' },
        body:
          '<!-- Compatibility headings keep the link checker aligned with the rendered aliases above.\n' +
          '###### Alias\n' +
          '-->',
      },
      'body is required',
    ],
    [
      'unexpected validator marker',
      {
        data: { title: 'Title', description: 'Description' },
        body: 'Body\n\n<!-- Compatibility headings keep the link checker aligned -->',
      },
      'source-only validator marker remains',
    ],
  ])('rejects a malformed %s entry explicitly', (_name, malformed, message) => {
    expect(() => serializeGuideMarkdown(malformed)).toThrow(message);
    expect(() => createGuideMarkdownResponse(malformed)).toThrow(message);
  });
});
