import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/lib/content.mjs';
import {
  createWalkthroughMarkdownResponse,
  serializeWalkthroughMarkdown,
  WALKTHROUGH_DOWNLOAD_FILENAME,
  WALKTHROUGH_MARKDOWN_MIME,
  type WalkthroughDownloadEntry,
} from '../../src/lib/walkthrough-download';

const source = readFileSync(resolve('content/walkthrough.md'), 'utf8');
const parsed = parseFrontmatter(source);
if (
  !parsed.data ||
  !('title' in parsed.data) ||
  typeof parsed.data.title !== 'string' ||
  !('description' in parsed.data) ||
  typeof parsed.data.description !== 'string'
) {
  throw new Error('walkthrough fixture requires title and description frontmatter');
}
const { title, description } = parsed.data;

const entry: WalkthroughDownloadEntry = {
  data: parsed.data,
  body: parsed.body,
};
const expectedBody = parsed.body
  .replace(/\r\n?/g, '\n')
  .replace(/^[\t ]*<!--[\t ]*quote:[\t ]*not-gist[\t ]*-->[\t ]*(?:\n|$)/gim, '')
  .replace(/^\n+|\n+$/g, '');
const expected = `# ${title}\n\n${description}\n\n${expectedBody}\n`;

describe('walkthrough Markdown download', () => {
  it('serializes the complete checked-in entry in exact source order', () => {
    const markdown = serializeWalkthroughMarkdown(entry);

    expect(markdown).toBe(expected);
    expect(markdown.match(/^# /gm)).toHaveLength(1);
    expect(markdown.startsWith(`# ${title}\n\n${description}\n\n`)).toBe(true);
    expect(markdown.match(/^##? /gm)).toHaveLength(20);
    expect(markdown).toContain('| Template section | Evidence in the example |');
    expect(markdown).toContain('> Home Page  \n> New List');
    expect(markdown).toContain('[Example PRD](/sample)');
    expect(markdown).toContain('`TECHNICAL_SPEC.md`');
    expect(markdown).toContain('**Use this**');
    expect(markdown).not.toContain('<!-- quote: not-gist -->');
    expect(markdown).not.toMatch(/^---$/m);
    expect(markdown).not.toContain('\r');
    expect(markdown).toMatch(/[^\n]\n$/);
    expect(markdown).not.toMatch(/\n\n$/);
  });

  it('returns deterministic UTF-8 response bytes and exact attachment metadata twice', async () => {
    const first = createWalkthroughMarkdownResponse(entry);
    const second = createWalkthroughMarkdownResponse(entry);
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const secondBytes = new Uint8Array(await second.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe(WALKTHROUGH_MARKDOWN_MIME);
    expect(first.headers.get('content-disposition')).toBe(
      `attachment; filename="${WALKTHROUGH_DOWNLOAD_FILENAME}"`,
    );
    expect(firstBytes.byteLength).toBeGreaterThan(0);
    expect(secondBytes).toEqual(firstBytes);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(firstBytes)).toBe(expected);
  });

  it('normalizes line endings and removes only the source validator line', () => {
    expect(
      serializeWalkthroughMarkdown({
        data: { title: 'Title', description: 'Opening description.' },
        body: '\r\nIntro with *emphasis*.\r\n\r\n<!-- quote: not-gist -->\r\n> Quote\r\n',
      }),
    ).toBe(
      '# Title\n\nOpening description.\n\nIntro with *emphasis*.\n\n> Quote\n',
    );
  });

  it.each([
    ['entry', undefined, 'content entry is required'],
    ['title', { data: { description: 'Description' }, body: 'Body' }, 'title is required'],
    ['description', { data: { title: 'Title' }, body: 'Body' }, 'description is required'],
    ['body', { data: { title: 'Title', description: 'Description' } }, 'body is required'],
    [
      'body after marker removal',
      {
        data: { title: 'Title', description: 'Description' },
        body: '<!-- quote: not-gist -->',
      },
      'body is required',
    ],
    [
      'unexpected validator marker',
      {
        data: { title: 'Title', description: 'Description' },
        body: 'Body\n\n<!-- quote: another-source -->',
      },
      'source-only validator marker remains',
    ],
  ])('rejects a malformed %s fixture explicitly', (_name, malformed, message) => {
    expect(() => serializeWalkthroughMarkdown(malformed)).toThrow(message);
    expect(() => createWalkthroughMarkdownResponse(malformed)).toThrow(message);
  });
});
