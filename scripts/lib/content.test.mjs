import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFile,
  collapseWs,
  extractBlockquotes,
  extractHeadings,
  extractInternalLinks,
  githubSlug,
  inlineText,
  makeSlugger,
  normalizeRoute,
  parseFrontmatter,
  quoteFragments,
  unwrapCodeSpans,
} from './content.mjs';

// A miniature gist, CRLF like the real snapshot.
const GIST = [
  '# Build The Urlist',
  '',
  'Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.',
  '',
  '## Mocks',
  '',
  '#### Home Page',
  '',
  '## Stack and design',
  '',
  '- Next.js App Router, React, strict TypeScript, Node.js, and npm',
  '- SQLite with direct parameterized SQL through `better-sqlite3`; no ORM',
  '',
  'Design system: use Bulma CSS for every screen (layout, navbar, cards, buttons, modals, forms, tags, dropdowns) and Font Awesome for all icons.',
  '',
  '## Theme, responsive UI, and accessibility',
  '',
  'Meet WCAG 2.2 AA, including full keyboard operation.',
].join('\r\n');

test('parseFrontmatter: quoted, bare and integer values; null without a leading ---', () => {
  const { data, body } = parseFrontmatter('---\ntitle: "Quoted: title"\ndescription: Bare description here\norder: 3\n---\n\nBody text\n');
  assert.deepEqual(data, { title: 'Quoted: title', description: 'Bare description here', order: 3 });
  assert.equal(body, '\nBody text\n', 'body starts right after the closing ---');
  assert.equal(parseFrontmatter("---\r\ntitle: 'single'\r\norder: \"7\"\r\n---\r\nx").data.title, 'single', 'single quotes and CRLF');
  assert.equal(parseFrontmatter("---\r\ntitle: 'single'\r\norder: \"7\"\r\n---\r\nx").data.order, '7', 'a quoted integer stays a string');
  assert.deepEqual(parseFrontmatter('# No frontmatter\n\ntext'), { data: null, body: '# No frontmatter\n\ntext' });
  assert.deepEqual(parseFrontmatter('---\nnever closed\n'), { data: null, body: '---\nnever closed\n' }, 'unclosed block is not frontmatter');
  assert.deepEqual(parseFrontmatter('---\n---\nbody').data, {}, 'empty frontmatter is an empty object');
});

test('collapseWs: trims and collapses whitespace runs, keeps every other character', () => {
  assert.equal(collapseWs('  a \r\n\t b\u00a0\u00a0c  '), 'a b c');
  assert.equal(collapseWs('“smart” — quotes… stay'), '“smart” — quotes… stay');
  assert.equal(collapseWs(null), '');
});

test('extractBlockquotes: single, multi-line, paragraph break, fenced ignored', () => {
  const body = [
    'Intro',
    '> single',
    '',
    '> line one',
    '> line two',
    '>',
    '> new paragraph',
    '',
    '```md',
    '> not a quote',
    '```',
    '',
    '    > indented four is code, not a quote',
    '>no space',
  ].join('\n');
  const quotes = extractBlockquotes(body);
  assert.deepEqual(
    quotes,
    [
      { line: 2, text: 'single' },
      { line: 4, text: 'line one\nline two\n\nnew paragraph' },
      { line: 14, text: 'no space' },
    ],
  );
  assert.equal(collapseWs(quotes[1].text), 'line one line two new paragraph');
});

test('quoteFragments: splits on … / ... / […] / [...], collapses whitespace, drops fragments under 12 chars', () => {
  assert.deepEqual(
    quoteFragments('Build the complete application … stop only when\r\n the app is complete.'),
    ['Build the complete application', 'stop only when the app is complete.'],
  );
  assert.deepEqual(quoteFragments('one two three... four five six [...] short [...] seven eight nine ten'), [
    'one two three',
    'four five six',
    'seven eight nine ten',
  ]);
  assert.deepEqual(quoteFragments('[…] eleven chars! […]'), ['eleven chars!']);
  assert.deepEqual(quoteFragments('> …'), [], 'nothing long enough');
  assert.deepEqual(quoteFragments('exactly 11c'), [], '11 characters are dropped');
  assert.deepEqual(quoteFragments('exactly 12ch'), ['exactly 12ch'], '12 characters are kept');
});

test('unwrapCodeSpans: a span becomes its content, one space stripped from each end like CommonMark; unclosed backtick stays literal', () => {
  assert.equal(unwrapCodeSpans('`#### New List: Validation States`'), '#### New List: Validation States');
  assert.equal(unwrapCodeSpans('The `#### New List` heading'), 'The #### New List heading');
  assert.equal(unwrapCodeSpans('`a` and `b`'), 'a and b', 'each span is unwrapped on its own');
  assert.equal(unwrapCodeSpans('`` a ` b ``'), 'a ` b', 'a two-backtick run may hold a single backtick; the one space each side is stripped');
  assert.equal(unwrapCodeSpans('`` `code` ``'), '`code`');
  assert.equal(unwrapCodeSpans('` a`'), ' a', 'a space on one side only is kept');
  assert.equal(unwrapCodeSpans('` `'), ' ', 'all-space content is kept');
  assert.equal(unwrapCodeSpans('an `unclosed backtick'), 'an `unclosed backtick');
  assert.equal(unwrapCodeSpans('```\nfenced\n```'), '\nfenced\n', 'a fence quoted whole loses its markers like any span (both sides of the check alike)');
  assert.equal(unwrapCodeSpans(null), '');
});

test('quoteFragments: code spans compare as their content — alone, mixed with prose, two-backtick runs; an unclosed backtick stays literal', () => {
  assert.deepEqual(quoteFragments('`#### New List: Validation States`'), ['#### New List: Validation States'], 'a quote that is one code span');
  assert.deepEqual(
    quoteFragments('The `#### New List` heading … stop only when `the app` is complete.'),
    ['The #### New List heading', 'stop only when the app is complete.'],
    'prose and spans join as plain text, then the ellipsis split applies',
  );
  assert.deepEqual(quoteFragments('`` a ` b `` and more text'), ['a ` b and more text'], 'two-backtick run with a single backtick inside');
  assert.deepEqual(quoteFragments('The `` `x` ``-style span here'), ['The `x`-style span here'], 'the stripped inner spaces leave no gap before -style');
  assert.deepEqual(quoteFragments('an `unclosed backtick stays literal'), ['an `unclosed backtick stays literal']);
});

test('githubSlug: the four gist examples, and makeSlugger suffixes duplicates -1, -2', () => {
  assert.equal(githubSlug('Theme, responsive UI, and accessibility'), 'theme-responsive-ui-and-accessibility');
  assert.equal(githubSlug('New List: Validation States'), 'new-list-validation-states');
  assert.equal(githubSlug('My Lists (Logged In)'), 'my-lists-logged-in');
  assert.equal(githubSlug('Published List: QR Code'), 'published-list-qr-code');
  assert.equal(githubSlug('4. Pin the stack and name the alternatives you are ruling out'), '4-pin-the-stack-and-name-the-alternatives-you-are-ruling-out');
  assert.equal(githubSlug("2. Show, don't describe"), '2-show-dont-describe');
  assert.equal(githubSlug('snake_case stays'), 'snake_case-stays', 'underscores survive like on GitHub');
  const slugger = makeSlugger();
  assert.deepEqual(['Mocks', 'Mocks', 'Delete', 'Mocks'].map((h) => slugger.slug(h)), ['mocks', 'mocks-1', 'delete', 'mocks-2']);
  slugger.reset();
  assert.equal(slugger.slug('Mocks'), 'mocks', 'reset clears the counters');
});

test('extractHeadings: depth, rendered text, per-document slugs; fenced and non-ATX lines ignored', () => {
  const body = [
    '# Title',
    '## Use `npm test` and [links](/guide) ##',
    '```',
    '## inside a fence',
    '```',
    '#hashtag is not a heading',
    '### Routes',
    '### Routes',
    '> #### Quoted heading',
    'Setext',
    '------',
  ].join('\n');
  assert.deepEqual(extractHeadings(body), [
    { line: 1, depth: 1, text: 'Title', slug: 'title' },
    { line: 2, depth: 2, text: 'Use npm test and links', slug: 'use-npm-test-and-links' },
    { line: 7, depth: 3, text: 'Routes', slug: 'routes' },
    { line: 8, depth: 3, text: 'Routes', slug: 'routes-1' },
    { line: 9, depth: 4, text: 'Quoted heading', slug: 'quoted-heading' },
  ]);
  assert.equal(inlineText('**Bold** _em_ ![alt](/x.png) &amp; <span>tag</span>'), 'Bold em alt & tag');
});

test('extractInternalLinks: root-relative and anchor-only; external, code and fenced skipped', () => {
  const body = [
    'See the [sample](/sample) and [its mocks](/sample#mocks "Mocks").',
    'Jump to [habits](#seven-habits) or ![shot](/mocks/01-home-page.png).',
    'Not ours: [gist](https://gist.github.com/x), [mail](mailto:a@b.c), [rel](./other.md), [proto](//cdn.example/x).',
    'In code: `[x](/nope)` and `[y](#nope)`',
    '```',
    '[z](/fenced)',
    '```',
  ].join('\n');
  assert.deepEqual(extractInternalLinks(body), [
    { line: 1, href: '/sample', path: '/sample', anchor: null },
    { line: 1, href: '/sample#mocks', path: '/sample', anchor: 'mocks' },
    { line: 2, href: '#seven-habits', path: '', anchor: 'seven-habits' },
    { line: 2, href: '/mocks/01-home-page.png', path: '/mocks/01-home-page.png', anchor: null },
  ]);
  assert.equal(normalizeRoute('/guide/'), '/guide');
  assert.equal(normalizeRoute('/'), '/');
});

const SITE_ROUTES = ['/', '/sample', '/guide', '/walkthrough', '/template', '/prd-template.md', '/raw/build-the-urlist.md', '/mocks/01-home-page.png'];

// Line numbers below are absolute in the file (frontmatter included).
const FIXTURE = [
  '---', // 1
  'title: "Fixture page"', // 2
  'description: "A page with one of everything"', // 3
  'order: 9', // 4
  '---', // 5
  '', // 6
  'Intro with a [good link](/sample#stack-and-design) and a [bad route](/nowhere).', // 7
  '', // 8
  '> Build the complete application in this repository.', // 9  (good, exact)
  '> Work autonomously from start to finish … when the app is complete.', // 10 (good, ellipsis)
  '', // 11
  '> Design system: use Bulma CSS for every screen and Font Awesome for all icons.', // 12 (bad: words skipped without an ellipsis)
  '', // 13
  '<!-- quote: not-gist -->', // 14
  '> This opted-out sentence is nowhere in the gist.', // 15
  '', // 16
  '## Own heading', // 17
  '', // 18
  'A [bad anchor](/sample#no-such-heading), a [good same-page anchor](#own-heading), and a [not-yet page](/guide#anything).', // 19
].join('\r\n');

test('checkFile: fixture → exactly the quote, link-route and link-anchor issues with their lines', () => {
  const issues = checkFile({
    name: 'content/fixture.md',
    text: FIXTURE,
    gistText: GIST,
    gistHeadings: extractHeadings(GIST),
    siteRoutes: SITE_ROUTES,
    pages: {}, // /guide not present → its anchor is skipped
  });
  assert.equal(issues.length, 3, JSON.stringify(issues, null, 2));
  assert.deepEqual(
    issues.map(({ line, kind }) => ({ line, kind })),
    [
      { line: 7, kind: 'link-route' },
      { line: 12, kind: 'quote' },
      { line: 19, kind: 'link-anchor' },
    ],
  );
  assert.match(issues[0].message, /\/nowhere/);
  assert.match(issues[1].message, /matches the gist up to ".*every screen"/, 'points at where the quote diverges');
  assert.match(issues[2].message, /#no-such-heading/);
});

test('checkFile: a quote whose paragraphs are each in the gist but not adjacent gets one actionable issue; `> …` between them fixes it', () => {
  const base = { name: 'x.md', gistText: GIST, siteRoutes: SITE_ROUTES, pages: {} };
  const fm = '---\ntitle: t\ndescription: d\norder: 1\n---\n';
  const gap = checkFile({ ...base, text: `${fm}> Build the complete application in this repository.\n>\n> Meet WCAG 2.2 AA, including full keyboard operation.` });
  assert.equal(gap.length, 1);
  assert.equal(gap[0].kind, 'quote');
  assert.equal(gap[0].line, 6);
  assert.match(gap[0].message, /not adjacent/);
  const marked = checkFile({ ...base, text: `${fm}> Build the complete application in this repository.\n>\n> …\n>\n> Meet WCAG 2.2 AA, including full keyboard operation.` });
  assert.deepEqual(marked, []);
  const adjacent = checkFile({ ...base, text: `${fm}> - Next.js App Router, React, strict TypeScript, Node.js, and npm\n> - SQLite with direct parameterized SQL through \`better-sqlite3\`; no ORM` });
  assert.deepEqual(adjacent, [], 'list items that are adjacent in the gist pass as one fragment');
});

test('checkFile: a quote that is one code span of gist text passes; a span of non-gist text still fails; both sides compare as rendered text', () => {
  const base = { name: 'x.md', gistText: GIST, siteRoutes: SITE_ROUTES, pages: {} };
  const fm = '---\ntitle: t\ndescription: d\norder: 1\n---\n';
  assert.deepEqual(checkFile({ ...base, text: `${fm}> \`#### Home Page\`` }), [], 'the span content is a gist heading; only the backticks are ours');
  const bad = checkFile({ ...base, text: `${fm}> \`#### Home Page: Empty State\`` });
  assert.equal(bad.length, 1, JSON.stringify(bad));
  assert.equal(bad[0].kind, 'quote');
  assert.equal(bad[0].line, 6);
  assert.equal(bad[0].message, 'not verbatim: matches the gist up to "#### Home Page", then ": Empty State" differs');
  const mixed = checkFile({ ...base, text: `${fm}> The \`#### New List\` heading …` });
  assert.equal(mixed.length, 1, JSON.stringify(mixed));
  assert.match(mixed[0].message, /^not in the gist: "The #### New List heading"/, 'the message shows the joined plain text, without backticks');
  assert.deepEqual(
    checkFile({ ...base, text: `${fm}> SQLite with direct parameterized SQL through better-sqlite3; no ORM` }),
    [],
    'the gist is unwrapped the same way, so its own spans compare as text too',
  );
});

test('checkFile: frontmatter and h1 rules; anchors resolve against the target page when present', () => {
  const noFm = checkFile({ name: 'x.md', text: '# Title\n\ntext', gistText: GIST, siteRoutes: SITE_ROUTES, pages: {} });
  assert.deepEqual(noFm.map((i) => [i.line, i.kind]), [[1, 'frontmatter'], [1, 'h1-in-body']]);

  const badFm = checkFile({
    name: 'x.md',
    text: '---\ntitle: ""\norder: "2"\n---\ntext [a](/guide#who-is-reading) [b](/guide#nope)',
    gistText: GIST,
    siteRoutes: SITE_ROUTES,
    pages: { '/guide': extractHeadings('## Who is reading') },
  });
  assert.deepEqual(
    badFm.map((i) => i.kind),
    ['frontmatter', 'frontmatter', 'frontmatter', 'link-anchor'],
    'empty title, missing description, non-integer order, then the bad /guide anchor',
  );
  assert.equal(badFm[3].line, 5);
});
