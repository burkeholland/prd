// Content accuracy check (node:test, zero dependencies): every blockquote in
// `content/*.md` is a verbatim excerpt of the gist and every internal link and
// anchor resolves. Run with `node --test scripts/check-content.mjs`.
//
// Another checkout can be targeted with `CONTENT_ROOT=<dir>` (works with
// `node --test`) or `node scripts/check-content.mjs --root <dir>`; the root must
// hold `content/`, `content/gist/build-the-urlist.md`, `public/raw/build-the-urlist.md`
// and `public/mocks/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFile, extractBlockquotes, extractHeadings, extractInternalLinks, parseFrontmatter, quoteFragments } from './lib/content.mjs';

const PAGE_ROUTES = ['/', '/sample', '/guide', '/walkthrough', '/template'];
const FILE_ROUTES = ['/prd-template.md', '/raw/build-the-urlist.md'];

function resolveRoot() {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  if (process.env.CONTENT_ROOT) return path.resolve(process.env.CONTENT_ROOT);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const ROOT = resolveRoot();
const CONTENT_DIR = path.join(ROOT, 'content');
const GIST_RAW = path.join(ROOT, 'public', 'raw', 'build-the-urlist.md');
const GIST_CONTENT = path.join(ROOT, 'content', 'gist', 'build-the-urlist.md');
const MOCKS_DIR = path.join(ROOT, 'public', 'mocks');

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** Every file under `public/` as a root-relative URL, e.g. `/mocks/01-home-page.png`. */
function publicRoutes(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...publicRoutes(path.join(dir, entry.name), p));
    else out.push(p);
  }
  return out;
}

const contentFiles = existsSync(CONTENT_DIR)
  ? readdirSync(CONTENT_DIR)
      .filter((f) => f.endsWith('.md') && statSync(path.join(CONTENT_DIR, f)).isFile())
      .sort()
      .map((f) => path.join(CONTENT_DIR, f))
  : [];

const gistText = read(GIST_RAW);
const gistContent = read(GIST_CONTENT);
const gistHeadings = gistContent === null ? null : extractHeadings(parseFrontmatter(gistContent).body);
const siteRoutes = [...PAGE_ROUTES, ...FILE_ROUTES, ...publicRoutes(path.join(ROOT, 'public'))];
const texts = new Map(contentFiles.map((f) => [f, readFileSync(f, 'utf8')]));
const pages = Object.fromEntries(
  [...texts].map(([f, text]) => [`/${path.basename(f, '.md')}`, extractHeadings(parseFrontmatter(text).body)]),
);

/** `guide.md: 12 quotes / 15 fragments / 24 links` — the numbers the report asks for. */
function stats(text) {
  const { body } = parseFrontmatter(text);
  const quotes = extractBlockquotes(body);
  const fragments = quotes.reduce((n, q) => n + quoteFragments(q.text).length, 0);
  return { quotes: quotes.length, fragments, links: extractInternalLinks(body).length };
}

if (contentFiles.length === 0) {
  test(`content/*.md in ${ROOT}`, (t) => {
    t.skip('not present yet');
  });
}

for (const file of contentFiles) {
  const name = rel(file);
  test(`${name}: quotes verbatim, links resolvable`, (t) => {
    assert.ok(gistText !== null, `${rel(GIST_RAW)} is missing — run \`node scripts/fetch-gist.mjs\``);
    const text = texts.get(file);
    const issues = checkFile({ name, text, gistText, gistHeadings, siteRoutes, pages });
    const { quotes, fragments, links } = stats(text);
    t.diagnostic(`${name}: ${quotes} quotes / ${fragments} fragments / ${links} internal links / ${issues.length} issues`);
    assert.equal(
      issues.length,
      0,
      [`${issues.length} issue(s) in ${name}:`, ...issues.map((i) => `${name}:${i.line} ${i.kind} — ${i.message}`)].join('\n'),
    );
  });
}

test('content/gist/build-the-urlist.md: the seven /mocks/*.png exist under public/mocks/', (t) => {
  if (gistContent === null) {
    t.skip(`${rel(GIST_CONTENT)} not present yet`);
    return;
  }
  const srcs = [...gistContent.matchAll(/src="\/mocks\/([^"]+)"/g)].map((m) => m[1]);
  assert.equal(srcs.length, 7, `expected 7 /mocks/ images in the gist content, found ${srcs.length}`);
  const missing = srcs.filter((f) => !existsSync(path.join(MOCKS_DIR, f)));
  assert.deepEqual(missing, [], `missing under ${rel(MOCKS_DIR)}/: ${missing.join(', ')}`);
});
