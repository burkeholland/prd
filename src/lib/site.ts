export const SITE = {
  name: 'PRD Field Guide',
  tagline:
    'How to write a product requirements doc an AI agent can build from — with a real one as the worked example.',
  gistUrl: 'https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817',
  gistTitle: 'Build The Urlist',
} as const;

export const NAV = [
  { href: '/', label: 'Home' },
  { href: '/sample', label: 'The sample PRD' },
  { href: '/guide', label: 'How to write one' },
  { href: '/walkthrough', label: 'Worked example' },
  { href: '/template', label: 'Template' },
] as const;

// Fixed route → content entry map. Pages look entries up by id, never by listing.
export const DOC_ROUTES = {
  '/sample': { collection: 'gist', id: 'build-the-urlist', label: 'The sample PRD' },
  '/guide': { collection: 'docs', id: 'guide', label: 'How to write one' },
  '/walkthrough': { collection: 'docs', id: 'walkthrough', label: 'Worked example' },
  '/template': { collection: 'docs', id: 'template', label: 'Template' },
} as const;

export const PLACEHOLDER = 'Content is on its way.';
