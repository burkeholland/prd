export const SITE = {
  name: 'PRD Field Guide',
  tagline:
    'How to write a product requirements doc an AI agent can build from — with a real one as the worked example.',
  gistUrl: 'https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817',
  gistTitle: 'Build The Urlist',
  repoUrl: 'https://github.com/burkeholland/prd',
} as const;

// Internal page hrefs carry a trailing slash (GitHub Pages serves the directory form
// without a redirect). Render them through `withBase()` from ./base.
// One name per page, site-wide: the nav label is also how running text refers to the page
// ("the guide", "the walkthrough", "the template"), so a sentence can be mapped to the nav.
export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/sample/', label: 'The sample PRD' },
  { href: '/guide/', label: 'The guide' },
  { href: '/walkthrough/', label: 'The walkthrough' },
  { href: '/history/', label: 'How it evolved' },
  { href: '/template/', label: 'The template' },
] as const;

// Fixed route → content entry map. Pages look entries up by id, never by listing.
export const DOC_ROUTES = {
  '/sample': { collection: 'gist', id: 'build-the-urlist', label: 'The sample PRD' },
  '/guide': { collection: 'docs', id: 'guide', label: 'The guide' },
  '/walkthrough': { collection: 'docs', id: 'walkthrough', label: 'The walkthrough' },
  '/template': { collection: 'docs', id: 'template', label: 'The template' },
} as const;

export const PLACEHOLDER = 'Content is on its way.';
