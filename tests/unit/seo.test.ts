import { describe, expect, it } from 'vitest';
import { canonicalUrl, OG_IMAGE } from '../../src/lib/seo';

const SITE = 'https://burkeholland.github.io';

describe('canonicalUrl', () => {
  it('adds the trailing slash to a page path', () => {
    expect(canonicalUrl('/prd/sample', SITE)).toBe('https://burkeholland.github.io/prd/sample/');
  });

  it('keeps a single trailing slash on a page path that has one', () => {
    expect(canonicalUrl('/prd/sample/', SITE)).toBe('https://burkeholland.github.io/prd/sample/');
  });

  it('turns the bare base into the site root with a trailing slash', () => {
    expect(canonicalUrl('/prd', SITE)).toBe('https://burkeholland.github.io/prd/');
    expect(canonicalUrl('/prd/', SITE)).toBe('https://burkeholland.github.io/prd/');
  });

  it('leaves a file path without a trailing slash', () => {
    expect(canonicalUrl('/prd/raw/x.md', SITE)).toBe('https://burkeholland.github.io/prd/raw/x.md');
  });

  it('accepts the site as a URL object, as Astro.site provides it', () => {
    expect(canonicalUrl('/prd/guide', new URL(SITE))).toBe('https://burkeholland.github.io/prd/guide/');
  });
});

describe('OG_IMAGE', () => {
  it('describes the 1200×630 preview image under the site root', () => {
    expect(OG_IMAGE).toMatchObject({ path: '/og.png', width: 1200, height: 630 });
    expect(OG_IMAGE.alt).toContain('PRD Field Guide');
  });
});
