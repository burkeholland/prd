import { describe, expect, it, vi } from 'vitest';
import {
  parsePrdMarkdown,
  PRD_MARKDOWN_IMPORT_MAX_BYTES,
  readPrdMarkdownFile,
} from '../../src/lib/prd-import-markdown';
import {
  createBlankPrdTemplateState,
  PRD_TEMPLATE_SECTIONS,
  serializePrdMarkdown,
  type PrdTemplateState,
} from '../../src/lib/prd-template';

const stateWithSections = (indexes: readonly number[]): PrdTemplateState => {
  const blank = createBlankPrdTemplateState('Imported requirements');
  const values = { ...blank.values };
  for (const index of indexes) {
    const section = PRD_TEMPLATE_SECTIONS[index]!;
    values[section.id] = `Paragraph ${index + 1}.\n\n- Detail ${index + 1}`;
  }
  return { title: blank.title, values };
};

const fileFromBytes = (
  bytes: Uint8Array,
  {
    name = 'requirements.md',
    type = 'text/markdown',
    size = bytes.byteLength,
  }: { name?: string; type?: string; size?: number } = {},
): Pick<File, 'name' | 'type' | 'size' | 'arrayBuffer'> => ({
  name,
  type,
  size,
  arrayBuffer: async () => bytes.slice().buffer,
});

const fileFromText = (
  text: string,
  options?: { name?: string; type?: string; size?: number },
) => fileFromBytes(new TextEncoder().encode(text), options);

describe('parsePrdMarkdown', () => {
  it.each([
    { name: 'all sections', indexes: PRD_TEMPLATE_SECTIONS.map((_, index) => index) },
    { name: 'mixed sections', indexes: [1, 5, 10] },
    { name: 'title only', indexes: [] },
  ])('round-trips own-output Markdown with $name', ({ indexes }) => {
    const state = stateWithSections(indexes);
    const markdown = serializePrdMarkdown(state, { includeBlankSections: false });

    expect(parsePrdMarkdown(markdown)).toEqual({ status: 'valid', state });
  });

  it('preserves supported Markdown and internal blank lines without treating fenced headings as sections', () => {
    const body = [
      'First paragraph.',
      '',
      '- list item',
      '- [ ] task one',
      '- [x] task two',
      '',
      '```ts',
      '## Context and problem',
      'const value = "# still code";',
      '```',
      '',
      '> A quoted decision.',
      '',
      '[Supporting link](https://example.com/details)',
      '',
      '### Implementation detail',
      '',
      '#### Deeper detail',
      '',
      'Final paragraph.',
    ].join('\n');
    const first = PRD_TEMPLATE_SECTIONS[0]!;
    const second = PRD_TEMPLATE_SECTIONS[1]!;
    const markdown = [
      '\uFEFF',
      '#   Syntax fixture   ',
      '',
      `##   ${first.title}   `,
      '',
      body,
      '',
      `## ${second.title}`,
      '',
      'Second body.',
      '',
    ].join('\r\n');
    const blank = createBlankPrdTemplateState('Syntax fixture');

    expect(parsePrdMarkdown(markdown)).toEqual({
      status: 'valid',
      state: {
        title: 'Syntax fixture',
        values: {
          ...blank.values,
          [first.id]: body,
          [second.id]: 'Second body.',
        },
      },
    });
  });

  it.each([
    {
      name: 'duplicate section',
      markdown: `# Title\n\n## ${PRD_TEMPLATE_SECTIONS[0]!.title}\n\nOne\n\n## ${PRD_TEMPLATE_SECTIONS[0]!.title}\n\nTwo\n`,
      reason: 'duplicate-section',
    },
    {
      name: 'out-of-order section',
      markdown: `# Title\n\n## ${PRD_TEMPLATE_SECTIONS[3]!.title}\n\nLater\n\n## ${PRD_TEMPLATE_SECTIONS[1]!.title}\n\nEarlier\n`,
      reason: 'out-of-order-section',
    },
    {
      name: 'unknown H2',
      markdown: '# Title\n\n## Delivery schedule\n\nUnknown\n',
      reason: 'unknown-section',
    },
    {
      name: 'missing H1',
      markdown: `## ${PRD_TEMPLATE_SECTIONS[0]!.title}\n\nBody\n`,
      reason: 'missing-title',
    },
    {
      name: 'multiple H1s',
      markdown: '# Title\n\n# Another title\n',
      reason: 'multiple-titles',
    },
    {
      name: 'preamble before H1',
      markdown: 'Introductory text\n\n# Title\n',
      reason: 'preamble-before-title',
    },
    {
      name: 'empty H1',
      markdown: '#   \n',
      reason: 'empty-title',
    },
    {
      name: 'body before first section',
      markdown: `# Title\n\nUnassigned text\n\n## ${PRD_TEMPLATE_SECTIONS[0]!.title}\n\nBody\n`,
      reason: 'content-before-section',
    },
    {
      name: 'noncanonical body without sections',
      markdown: '# Title\n\nAn arbitrary Markdown document.\n',
      reason: 'no-sections',
    },
  ] as const)('rejects $name', ({ markdown, reason }) => {
    expect(parsePrdMarkdown(markdown)).toMatchObject({ status: 'invalid', reason });
  });

  it('keeps all omitted canonical sections as empty strings', () => {
    const section = PRD_TEMPLATE_SECTIONS[6]!;
    const result = parsePrdMarkdown(`# Imported\n\n## ${section.title}\n\nRequired behavior.\n`);

    expect(result.status).toBe('valid');
    if (result.status !== 'valid') return;
    expect(result.state.title).toBe('Imported');
    expect(Object.keys(result.state.values)).toEqual(
      PRD_TEMPLATE_SECTIONS.map(({ id }) => id),
    );
    expect(result.state.values[section.id]).toBe('Required behavior.');
    expect(
      Object.entries(result.state.values)
        .filter(([id]) => id !== section.id)
        .map(([, value]) => value),
    ).toEqual(Array(11).fill(''));
  });
});

describe('readPrdMarkdownFile', () => {
  const canonical = serializePrdMarkdown(stateWithSections([0]), {
    includeBlankSections: false,
  });

  it.each([
    { name: 'requirements.md', type: '', text: canonical },
    { name: 'requirements', type: 'text/markdown', text: canonical.replaceAll('\n', '\r\n') },
    { name: 'requirements.txt', type: 'text/plain', text: `\uFEFF${canonical}` },
  ])('accepts $name with its supported name or media type', async ({ name, type, text }) => {
    await expect(readPrdMarkdownFile(fileFromText(text, { name, type }))).resolves
      .toEqual({ status: 'valid', state: stateWithSections([0]) });
  });

  it('accepts a file exactly 5 MiB and rejects a larger file before reading it', async () => {
    const canonicalBytes = new TextEncoder().encode(canonical);
    const maximumBytes = new Uint8Array(PRD_MARKDOWN_IMPORT_MAX_BYTES).fill(0x20);
    maximumBytes.set(canonicalBytes);
    await expect(readPrdMarkdownFile(fileFromBytes(maximumBytes))).resolves
      .toMatchObject({ status: 'valid' });

    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await expect(readPrdMarkdownFile({
      name: 'large.md',
      type: 'text/markdown',
      size: PRD_MARKDOWN_IMPORT_MAX_BYTES + 1,
      arrayBuffer,
    })).resolves.toEqual({ status: 'too-large' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8, unsupported files, and file read failures distinctly', async () => {
    await expect(readPrdMarkdownFile(fileFromBytes(
      Uint8Array.from([0x23, 0x20, 0xc3, 0x28]),
    ))).resolves.toEqual({ status: 'invalid-utf8' });
    await expect(readPrdMarkdownFile(fileFromText(canonical, {
      name: 'requirements.rtf',
      type: 'application/rtf',
    }))).resolves.toEqual({ status: 'unsupported-file' });
    await expect(readPrdMarkdownFile({
      name: 'requirements.md',
      type: 'text/markdown',
      size: 10,
      arrayBuffer: async () => {
        throw new DOMException('Unavailable', 'NotReadableError');
      },
    })).resolves.toEqual({ status: 'unreadable' });
  });
});
