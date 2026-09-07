import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractHandoffChecklistItems,
  HANDOFF_CHECKLIST_FILENAME,
  HANDOFF_CHECKLIST_ITEM_COUNT,
  HANDOFF_CHECKLIST_MIME,
  serializeHandoffChecklist,
} from '../../src/lib/handoff-checklist';
import {
  createHandoffChecklistResponse,
  GET,
  handoffChecklistItems,
  prerender,
} from '../../src/pages/downloads/prd-handoff-checklist.md';

const guideSource = readFileSync(resolve('content/guide.md'), 'utf8');
const expectedItems = [
  'Does the opening state the outcome and stop condition?',
  'Is every important screen and state shown or described exactly?',
  'Are the stack, environment, and meaningful constraints pinned?',
  'Are observable behaviors written with exact strings, numbers, and fallbacks?',
  'Are invariants and non-goals explicit?',
  'Does every requirement have a check that can pass or fail?',
  'Does the definition of done include exact commands and complete user journeys?',
] as const;

const fixture = (block: readonly string[], heading = true) =>
  [
    '# Guide',
    '',
    ...(heading ? ['## Before you hand it off', ''] : []),
    ...block,
    '',
    'Following prose.',
    '',
  ].join('\n');

describe('handoff checklist source extraction', () => {
  it('extracts the seven canonical item texts from the real Guide in source order', () => {
    const items = extractHandoffChecklistItems(guideSource);

    expect(items).toEqual(expectedItems);
    expect(items).toHaveLength(HANDOFF_CHECKLIST_ITEM_COUNT);
    expect(serializeHandoffChecklist(items)).toBe(
      expectedItems.map((item) => `- [ ] ${item}`).join('\n') + '\n',
    );
  });

  it.each([
    {
      name: 'missing heading',
      source: fixture(expectedItems.map((item) => `- [ ] ${item}`), false),
      message: /missing .* heading/i,
    },
    {
      name: 'wrong item count',
      source: fixture(
        expectedItems.slice(0, 6).map((item) => `- [ ] ${item}`),
      ),
      message: /expected exactly 7 .* found 6/i,
    },
    {
      name: 'blank item',
      source: fixture([
        ...expectedItems.slice(0, 3).map((item) => `- [ ] ${item}`),
        '- [ ] ',
        ...expectedItems.slice(4).map((item) => `- [ ] ${item}`),
      ]),
      message: /item .* is blank/i,
    },
    {
      name: 'non-task-list item',
      source: fixture([
        ...expectedItems.slice(0, 3).map((item) => `- [ ] ${item}`),
        '- Not a task-list item',
        ...expectedItems.slice(4).map((item) => `- [ ] ${item}`),
      ]),
      message: /not an unchecked Markdown task-list item/i,
    },
    {
      name: 'later-section boundary',
      source: fixture([
        ...expectedItems.slice(0, 6).map((item) => `- [ ] ${item}`),
        '## A later section',
        '- [ ] This must not be extracted',
      ]),
      message: /section boundary/i,
    },
  ])('rejects a $name fixture', ({ source, message }) => {
    expect(() => extractHandoffChecklistItems(source)).toThrow(message);
  });
});

describe('prerendered handoff checklist response', () => {
  it('returns the same deterministic UTF-8 attachment bytes twice', async () => {
    expect(prerender).toBe(true);
    expect(GET).toBe(createHandoffChecklistResponse);
    expect(handoffChecklistItems).toEqual(
      extractHandoffChecklistItems(guideSource),
    );

    const responses = [
      createHandoffChecklistResponse(),
      createHandoffChecklistResponse(),
    ];
    const bytes = await Promise.all(
      responses.map(async (response) =>
        new Uint8Array(await response.arrayBuffer()),
      ),
    );
    const expected = serializeHandoffChecklist(expectedItems);

    for (const [responseIndex, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        HANDOFF_CHECKLIST_MIME,
      );
      expect(response.headers.get('content-disposition')).toBe(
        `attachment; filename="${HANDOFF_CHECKLIST_FILENAME}"`,
      );
      const markdown = new TextDecoder('utf-8', { fatal: true }).decode(
        bytes[responseIndex],
      );
      expect(markdown).toBe(expected);
      expect(markdown.split('\n')).toEqual([
        ...expectedItems.map((item) => `- [ ] ${item}`),
        '',
      ]);
      expect(markdown.endsWith('\n')).toBe(true);
      expect(markdown.endsWith('\n\n')).toBe(false);
    }

    expect(bytes[0]).toEqual(bytes[1]);
  });
});
