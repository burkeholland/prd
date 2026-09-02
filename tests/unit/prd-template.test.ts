import { describe, expect, it } from 'vitest';
import {
  createBlankPrdTemplateState,
  PRD_TEMPLATE,
  PRD_TEMPLATE_SECTIONS,
  serializeBlankPrdMarkdown,
  serializePrdMarkdown,
  type PrdTemplateSectionId,
} from '../../src/lib/prd-template';

const EXPECTED_IDS = [
  'summary-outcome',
  'context-problem',
  'goals-success',
  'users-use-cases',
  'scope-non-goals',
  'user-experience',
  'functional-requirements',
  'data-apis-integrations',
  'constraints-decisions',
  'security-privacy-permissions',
  'acceptance-recovery',
  'validation-done',
] as const satisfies readonly PrdTemplateSectionId[];

const headings = (markdown: string, level: 1 | 2): string[] => {
  const prefix = '#'.repeat(level);
  return Array.from(markdown.matchAll(new RegExp(`^${prefix} (.+)$`, 'gm')), (match) => match[1] ?? '');
};

describe('PRD_TEMPLATE', () => {
  it('defines exactly 12 stable, unique sections in the prescribed order', () => {
    const ids = PRD_TEMPLATE_SECTIONS.map((section) => section.id);

    expect(ids).toEqual(EXPECTED_IDS);
    expect(new Set(ids).size).toBe(12);
  });

  it('gives every section a title, a concise decision prompt, and a blank default value', () => {
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(section.title.trim()).not.toBe('');
      expect(section.prompt.trim()).not.toBe('');
      expect(section.prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(45);
      expect(section.defaultValue).toBe('');
    }
  });

  it('presents the sections as adaptable rather than universal', () => {
    expect(PRD_TEMPLATE.guidance).toMatch(/starting point/i);
    expect(PRD_TEMPLATE.guidance).toMatch(/change/i);
    expect(PRD_TEMPLATE.guidance).toMatch(/remove/i);
    expect(PRD_TEMPLATE.guidance).toMatch(/skip/i);
  });

  it('creates complete blank state in model order', () => {
    const state = createBlankPrdTemplateState('My product');

    expect(state.title).toBe('My product');
    expect(Object.keys(state.values)).toEqual(EXPECTED_IDS);
    expect(Object.values(state.values).every((value) => value === '')).toBe(true);
  });
});

describe('serializePrdMarkdown', () => {
  it('serializes a blank template with one H1, 12 ordered H2s, and useful placeholders', () => {
    const markdown = serializeBlankPrdMarkdown('New product');

    expect(headings(markdown, 1)).toEqual(['New product']);
    expect(headings(markdown, 2)).toEqual(
      PRD_TEMPLATE_SECTIONS.map((section) => section.title),
    );
    for (const section of PRD_TEMPLATE_SECTIONS) {
      expect(markdown).toContain(`{${section.title}}`);
      expect(markdown).not.toContain(section.prompt);
      for (const question of section.helperQuestions ?? []) {
        expect(markdown).not.toContain(question);
      }
    }
    expect(markdown).not.toContain(PRD_TEMPLATE.guidance);
    expect(markdown).not.toMatch(/\*\*(?:Write|Example|Template):\*\*/);
  });

  it('keeps a filled title and every section value while normalizing line endings', () => {
    const values = Object.fromEntries(
      PRD_TEMPLATE_SECTIONS.map((section, index) => [
        section.id,
        `Decision ${index + 1} for ${section.id}\r\nSupporting detail ${index + 1}.`,
      ]),
    ) as Record<PrdTemplateSectionId, string>;

    const markdown = serializePrdMarkdown({ title: 'Launch brief', values });

    expect(headings(markdown, 1)).toEqual(['Launch brief']);
    expect(headings(markdown, 2)).toHaveLength(12);
    for (const [id, value] of Object.entries(values)) {
      expect(markdown, id).toContain(value.replace(/\r\n/g, '\n'));
    }
    expect(markdown).not.toContain('\r');
    expect(markdown).not.toContain('{Product summary and desired outcome}');
  });

  it('never interpolates null or undefined values into completed Markdown', () => {
    const markdown = serializePrdMarkdown({
      title: null,
      values: {
        'summary-outcome': null,
        'context-problem': undefined,
      },
    });

    expect(markdown.startsWith(`# ${PRD_TEMPLATE.defaultTitle}\n`)).toBe(true);
    expect(markdown).not.toMatch(/\b(?:null|undefined)\b/);
    expect(headings(markdown, 1)).toHaveLength(1);
    expect(headings(markdown, 2)).toHaveLength(12);
  });

  it('produces the same Markdown for the same state', () => {
    const state = createBlankPrdTemplateState();

    expect(serializePrdMarkdown(state)).toBe(serializePrdMarkdown(state));
  });
});
