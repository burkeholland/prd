export const SITE = {
  name: 'PRD Template',
  tagline: 'Use this template as a starting point. Add, remove, or change sections to fit your project.',
  gistUrl: 'https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817',
  gistTitle: 'Build The Urlist',
  repoUrl: 'https://github.com/burkeholland/prd',
} as const;

// Internal page hrefs carry a trailing slash (GitHub Pages serves the directory form
// without a redirect). Render them through `withBase()` from ./base.
// The brand is a separate Home link; these are the site's three primary actions.
export const NAV = [
  { href: '/', label: 'Create' },
  { href: '/sample/', label: 'Example' },
  { href: '/#downloads', label: 'Downloads' },
] as const;

// Fixed route → content entry map. Pages look entries up by id, never by listing.
export const DOC_ROUTES = {
  '/sample': { collection: 'gist', id: 'build-the-urlist', label: 'Example PRD' },
  '/guide': { collection: 'docs', id: 'guide', label: 'What makes a good PRD' },
  '/walkthrough': { collection: 'docs', id: 'walkthrough', label: 'The walkthrough' },
  '/template': { collection: 'docs', id: 'template', label: 'PRD template' },
} as const;

export const PLACEHOLDER = 'Content is on its way.';
