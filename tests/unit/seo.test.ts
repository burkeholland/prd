import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalUrl, OG_IMAGE, SOCIAL_CARDS, socialCard } from '../../src/lib/seo';

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
    expect(OG_IMAGE.alt).toContain('PRD Template');
  });
});

describe('SOCIAL_CARDS', () => {
  const routes = Object.keys(SOCIAL_CARDS);
  const cards = Object.values(SOCIAL_CARDS);

  it('has one card per page, keyed by the canonical route', () => {
    expect(routes).toEqual(['/', '/sample/', '/guide/', '/walkthrough/', '/history/', '/template/']);
  });

  it('uses the site-wide image and alt for the home page and a distinct file per other page', () => {
    expect(SOCIAL_CARDS['/']).toMatchObject({ file: OG_IMAGE.path, title: 'PRD Template', alt: OG_IMAGE.alt });
    const files = cards.map((card) => card.file);
    expect(new Set(files).size).toBe(files.length);
    for (const [route, card] of Object.entries(SOCIAL_CARDS)) {
      if (route === '/') continue;
      expect(card.file, `${route} file`).toMatch(/^\/og\/[a-z-]+\.png$/);
      expect(card.alt, `${route} alt`).toBe(`${card.title} — PRD Template`);
    }
  });

  it('uses generic descriptions for the home and example cards', () => {
    expect(SOCIAL_CARDS['/'].subtitle).toBe(
      'Use this template as a starting point. Add, remove, or change sections to fit your project.',
    );
    expect(SOCIAL_CARDS['/sample/']).toMatchObject({
      title: 'Example PRD',
      subtitle:
        'A complete PRD for a link-sharing app, with mocks, routes, data rules, tests, and completion checks.',
    });
    expect(`${SOCIAL_CARDS['/'].subtitle} ${SOCIAL_CARDS['/sample/'].subtitle}`).not.toMatch(
      /Burke|Microsoft|one[- ]?(?:shot|pass)|proof|showcase/i,
    );
  });

  it('names a PNG that exists under public/ for every card', () => {
    for (const card of cards) {
      expect(existsSync(resolve('public', `.${card.file}`)), `public${card.file}`).toBe(true);
    }
  });
});

describe('socialCard', () => {
  it('finds the page card by its pathname under the base, with or without the trailing slash', () => {
    expect(socialCard('/prd/history/', '/prd')).toBe(SOCIAL_CARDS['/history/']);
    expect(socialCard('/prd/history', '/prd')).toBe(SOCIAL_CARDS['/history/']);
    expect(socialCard('/prd/sample/', '/prd')).toBe(SOCIAL_CARDS['/sample/']);
  });

  it('gives the home card for the base itself', () => {
    expect(socialCard('/prd/', '/prd')).toBe(SOCIAL_CARDS['/']);
    expect(socialCard('/prd', '/prd')).toBe(SOCIAL_CARDS['/']);
  });

  it('falls back to the home card for pages that have no card of their own', () => {
    expect(socialCard('/prd/history/3/', '/prd')).toBe(SOCIAL_CARDS['/']);
    expect(socialCard('/prd/nope/', '/prd')).toBe(SOCIAL_CARDS['/']);
    expect(socialCard('/prd/404/', '/prd')).toBe(SOCIAL_CARDS['/']);
  });

  it('accepts the base with a trailing slash, as import.meta.env.BASE_URL may give it', () => {
    expect(socialCard('/prd/guide/', '/prd/')).toBe(SOCIAL_CARDS['/guide/']);
    expect(socialCard('/prd/', '/prd/')).toBe(SOCIAL_CARDS['/']);
  });

  it('works with a root base (custom domain)', () => {
    expect(socialCard('/guide/', '/')).toBe(SOCIAL_CARDS['/guide/']);
    expect(socialCard('/guide', '/')).toBe(SOCIAL_CARDS['/guide/']);
    expect(socialCard('/', '/')).toBe(SOCIAL_CARDS['/']);
    expect(socialCard('/history/3/', '/')).toBe(SOCIAL_CARDS['/']);
  });

  it('does not treat a path that merely starts with the base letters as inside the base', () => {
    expect(socialCard('/prdx/guide/', '/prd')).toBe(SOCIAL_CARDS['/']);
  });
});
