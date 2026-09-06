import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRD_TEMPLATE_SECTIONS } from '../../src/lib/prd-template';
import { PRD_TEMPLATE_ALIASES } from '../../src/lib/prd-template-compat';
import { checkFile, extractHeadings, parseFrontmatter } from '../../scripts/lib/content.mjs';

const historicalFragments = [
  'mission-and-stop-condition',
  'mocks',
  'technical-specification-and-checklist',
  'stack-and-design',
  'product',
  'routes',
  'navigation',
  'screens',
  'data-and-integrations',
  'identity-and-ownership',
  'theme-responsive-ui-and-accessibility',
  'storage-and-security',
  'scripts-tests-and-documentation',
  'completion',
];

describe('legacy template compatibility', () => {
  it('maps every former section fragment to a current section without duplicate IDs', () => {
    expect(Object.keys(PRD_TEMPLATE_ALIASES)).toEqual(historicalFragments);
    const canonicalIds = PRD_TEMPLATE_SECTIONS.map(({ id }) => id);
    for (const target of Object.values(PRD_TEMPLATE_ALIASES)) {
      expect(canonicalIds).toContain(target);
    }
    const ids = [...canonicalIds, ...Object.keys(PRD_TEMPLATE_ALIASES)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps only metadata and introductory prose in the content entry', () => {
    const entry = readFileSync(new URL('../../content/template.md', import.meta.url), 'utf8');
    const { body } = parseFrontmatter(entry);
    expect(extractHeadings(body)).toEqual([]);
    expect(body).not.toContain('```');
    expect(body).toContain('src/lib/prd-template.ts');
    for (const { title } of PRD_TEMPLATE_SECTIONS) expect(body).not.toContain(title);
    expect(existsSync(new URL('../../public/prd-template.md', import.meta.url))).toBe(false);
  });

  it('lets the content checker resolve generated and legacy fragments but reject unknown ones', () => {
    const ids = [...PRD_TEMPLATE_SECTIONS.map(({ id }) => id), ...Object.keys(PRD_TEMPLATE_ALIASES)];
    const check = (fragments: string[]) => checkFile({
      name: 'content/guide.md',
      text: `---\ntitle: "Guide"\ndescription: "Guide"\norder: 1\n---\n\n${fragments.map((id) => `[Section](/template#${id})`).join('\n')}`,
      gistText: '',
      gistHeadings: [],
      siteRoutes: ['/template'],
      pages: { '/template': ids },
    });
    expect(check(ids)).toEqual([]);
    expect(check(['not-a-template-section'])).toEqual([
      expect.objectContaining({ kind: 'link-anchor' }),
    ]);
  });
});
