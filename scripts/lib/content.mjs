// Pure helpers for the content accuracy check: frontmatter, blockquotes,
// headings (GitHub/Astro slugs) and internal links of the authored markdown in
// `content/*.md`, plus `checkFile`, which turns them into a list of issues.
// No I/O and no dependencies (see content.test.mjs; the runner is
// ../check-content.mjs). Line numbers are 1-based; the extract* functions
// count from the start of the text they are given, `checkFile` reports
// file-absolute lines.

const NEWLINE_RE = /\r?\n/;
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const QUOTE_LINE_RE = /^ {0,3}>/;
const QUOTE_MARKER_RE = /^ {0,3}> ?/;
const OPT_OUT_RE = /^<!--\s*quote:\s*not-gist\s*-->$/;
// `…`, `...` (or longer), `[…]`, `[...]`
const ELLIPSIS_RE = /\[(?:\u2026|\.{3,})\]|\u2026|\.{3,}/;
// Everything github-slugger removes: not a letter, mark, number, connector
// punctuation (`_`), space or hyphen.
const SLUG_STRIP_RE = /[^\p{L}\p{M}\p{N}\p{Pc} -]/gu;
// A code span (kept whole so links inside it are ignored) or a link/image
// destination: `](dest)` / `](dest "title")` / `](<dest>)`.
const CODE_OR_LINK_RE = /(`+)[\s\S]*?\1|\]\(\s*<?([^\s<>()]*)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

export const MIN_FRAGMENT_LENGTH = 12;

/** Trim and collapse every whitespace run (incl. CRLF, NBSP) to one space. Characters are otherwise untouched. */
export function collapseWs(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function splitLines(text) {
  return String(text ?? '').split(NEWLINE_RE);
}

/**
 * Boolean per line: true when the line is a fence delimiter or inside a
 * fenced code block (``` or ~~~, CommonMark closing rules).
 */
function fenceMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open = null; // { char, len }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open) {
      mask[i] = true;
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === open.char && m[1].length >= open.len) open = null;
      continue;
    }
    const m = FENCE_OPEN_RE.exec(line);
    if (m && !(m[1][0] === '`' && line.slice(m[0].length).includes('`'))) {
      open = { char: m[1][0], len: m[1].length };
      mask[i] = true;
    }
  }
  return mask;
}

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v[0] === '"' && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1).replace(/\\(["\\/bfnrt])/g, (_, c) => ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c] ?? c);
  }
  if (v[0] === "'" && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  if (v === 'null' || v === '~') return null;
  return v;
}

/**
 * Minimal YAML frontmatter: `key: value` lines between a leading `---` and the
 * next `---` line. Quoted or bare strings, integers/floats, booleans.
 * `data` is `null` when the text does not start with `---` (the whole text is
 * then the body).
 */
export function parseFrontmatter(text) {
  const src = String(text ?? '');
  const m = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: null, body: src };
  const data = {};
  for (const line of splitLines(m[1] ?? '')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const kv = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (kv) data[kv[1]] = parseScalar(kv[2] ?? '');
  }
  return { data, body: src.slice(m[0].length) };
}

/**
 * `[{ line, text }]` — consecutive lines starting with `>` form one quote.
 * The `>` and one optional space are stripped per line; a bare `>` line is a
 * paragraph break (empty line in `text`). Quotes inside fenced code are not
 * quotes. `line` is the first `>` line, 1-based within `body`.
 */
export function extractBlockquotes(body) {
  const lines = splitLines(body);
  const fenced = fenceMask(lines);
  const quotes = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    if (!fenced[i] && QUOTE_LINE_RE.test(lines[i])) {
      const inner = lines[i].replace(QUOTE_MARKER_RE, '');
      if (!current) {
        current = { line: i + 1, parts: [] };
        quotes.push(current);
      }
      current.parts.push(inner.trim() === '' ? '' : inner);
    } else {
      current = null;
    }
  }
  return quotes.map(({ line, parts }) => ({ line, text: parts.join('\n') }));
}

/**
 * Split a quote on ellipses (`…`, `...`, `[…]`, `[...]`), collapse whitespace
 * in each piece and drop pieces shorter than MIN_FRAGMENT_LENGTH characters.
 */
export function quoteFragments(text) {
  return String(text ?? '')
    .split(ELLIPSIS_RE)
    .map(collapseWs)
    .filter((f) => f.length >= MIN_FRAGMENT_LENGTH);
}

/** One heading → its GitHub/Astro slug, without duplicate handling. */
export function githubSlug(heading) {
  return String(heading ?? '').trim().toLowerCase().replace(SLUG_STRIP_RE, '').replace(/ /g, '-');
}

/**
 * A per-document slugger like `github-slugger`: the second occurrence of a
 * heading gets `-1`, the third `-2`, and so on.
 */
export function makeSlugger() {
  const seen = new Map();
  return {
    slug(heading) {
      const base = githubSlug(heading);
      let result = base;
      while (seen.has(result)) {
        seen.set(base, (seen.get(base) ?? 0) + 1);
        result = `${base}-${seen.get(base)}`;
      }
      seen.set(result, seen.get(result) ?? 0);
      return result;
    },
    reset() {
      seen.clear();
    },
  };
}

/** The rendered text of inline markdown: link text (not URL), image alt, code span content, no tags/emphasis markers. */
export function inlineText(md) {
  return String(md ?? '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]{1,3}(?=\S)/g, '$1')
    .replace(/(?<=\S)[*_]{1,3}(?=[\s).,;:!?]|$)/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * `[{ line, depth, text, slug }]` for ATX headings outside fenced code,
 * slugged with one slugger for the document (so repeated headings get
 * `-1`, `-2` like GitHub and Astro do).
 */
export function extractHeadings(body) {
  const lines = splitLines(body);
  const fenced = fenceMask(lines);
  const slugger = makeSlugger();
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const m = HEADING_RE.exec(lines[i]);
    if (!m) continue;
    const raw = (m[2] ?? '').replace(/(^|[ \t])#+$/, '').trim();
    const text = inlineText(raw);
    headings.push({ line: i + 1, depth: m[1].length, text, slug: slugger.slug(text) });
  }
  return headings;
}

/**
 * `[{ line, href, path, anchor }]` for markdown links and images whose
 * destination is root-relative (`/…`) or a same-page anchor (`#…`). External
 * (`http(s)://`, `mailto:`, `//…`), relative and in-code links are skipped.
 * `path` is `''` for same-page anchors; `anchor` is `null` when absent.
 */
export function extractInternalLinks(body) {
  const lines = splitLines(body);
  const fenced = fenceMask(lines);
  const links = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    CODE_OR_LINK_RE.lastIndex = 0;
    for (const m of lines[i].matchAll(CODE_OR_LINK_RE)) {
      if (m[1] !== undefined) continue; // code span
      const href = m[2] ?? '';
      if (!(href.startsWith('/') || href.startsWith('#')) || href.startsWith('//')) continue;
      const hash = href.indexOf('#');
      const path = hash === -1 ? href : href.slice(0, hash);
      const anchor = hash === -1 || hash === href.length - 1 ? null : href.slice(hash + 1);
      links.push({ line: i + 1, href, path, anchor });
    }
  }
  return links;
}

/** `/guide/` → `/guide`, `/` stays `/`; the query string is dropped. */
export function normalizeRoute(path) {
  const p = String(path ?? '').replace(/\?.*$/, '');
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

const excerpt = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tail = (s, n) => (s.length > n ? `…${s.slice(-(n - 1))}` : s);

/** Longest prefix length `n` such that `haystack.includes(fragment.slice(0, n))`. */
function matchedPrefixLength(haystack, fragment) {
  let lo = 0;
  let hi = fragment.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (haystack.includes(fragment.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function describeMismatch(gist, fragment) {
  const n = matchedPrefixLength(gist, fragment);
  if (n < MIN_FRAGMENT_LENGTH) {
    return `not in the gist: "${excerpt(fragment, 90)}" (if it is not meant as a gist excerpt, put \`<!-- quote: not-gist -->\` on the line above)`;
  }
  return `not verbatim: matches the gist up to "${tail(fragment.slice(0, n).trimEnd(), 40)}", then "${excerpt(fragment.slice(n).trimStart(), 40)}" differs`;
}

const PARAGRAPHS_NOT_ADJACENT =
  'each paragraph of this quote is in the gist, but they are not adjacent there — mark the gap with a `> …` line between them (or opt out with `<!-- quote: not-gist -->` above the quote)';

function quoteIssues(gist, text) {
  const failing = quoteFragments(text).filter((f) => !gist.includes(f));
  if (failing.length === 0) return [];
  const paragraphs = text.split(/\n[ \t]*\n/);
  if (paragraphs.length > 1 && paragraphs.flatMap(quoteFragments).every((f) => gist.includes(f))) return [PARAGRAPHS_NOT_ADJACENT];
  return failing.map((f) => describeMismatch(gist, f));
}

function slugSet(headings) {
  if (!headings) return null;
  return new Set(headings.map((h) => (typeof h === 'string' ? h : h.slug)));
}

/**
 * Check one authored page. Returns `issues: [{ line, kind, message }]` with
 * kind ∈ frontmatter | h1-in-body | quote | link-route | link-anchor, sorted
 * by line. Lines are absolute in `text`.
 *
 * - `gistText`: the verbatim gist (`public/raw/build-the-urlist.md`).
 * - `gistHeadings`: headings of the gist content file (targets of `/sample#…`);
 *   when null/undefined the anchors on `/sample` are not checked.
 * - `siteRoutes`: iterable of valid root-relative paths (`/`, `/guide`, `/mocks/01-home-page.png`, …).
 * - `pages`: `{ '/guide': headings, … }`; anchors on a route missing from it are skipped.
 */
export function checkFile({ name, text, gistText, gistHeadings, siteRoutes, pages }) {
  const issues = [];
  const push = (line, kind, message) => issues.push({ line, kind, message });
  const src = String(text ?? '');
  const { data, body } = parseFrontmatter(src);
  const offset = splitLines(src.slice(0, src.length - body.length)).length - 1;

  if (data === null) {
    push(1, 'frontmatter', 'missing frontmatter: the file must start with `---` title / description / order `---`');
  } else {
    if (typeof data.title !== 'string' || data.title.trim() === '') push(1, 'frontmatter', 'frontmatter needs a non-empty `title`');
    if (typeof data.description !== 'string' || data.description.trim() === '') push(1, 'frontmatter', 'frontmatter needs a non-empty `description`');
    if (!Number.isInteger(data.order)) push(1, 'frontmatter', `frontmatter needs an integer \`order\` (got ${JSON.stringify(data.order ?? null)})`);
  }

  const lines = splitLines(body);
  const headings = extractHeadings(body);
  for (const h of headings) {
    if (h.depth === 1) push(h.line + offset, 'h1-in-body', `h1 "${h.text}" in the body — the page supplies the h1, use ## or lower`);
  }

  const gist = collapseWs(gistText);
  for (const quote of extractBlockquotes(body)) {
    let above = quote.line - 2;
    while (above >= 0 && lines[above].trim() === '') above--;
    if (above >= 0 && OPT_OUT_RE.test(lines[above].trim())) continue;
    for (const message of quoteIssues(gist, quote.text)) push(quote.line + offset, 'quote', message);
  }

  const routes = new Set([...(siteRoutes ?? [])].map(normalizeRoute));
  const own = slugSet(headings);
  for (const link of extractInternalLinks(body)) {
    const line = link.line + offset;
    let target = own;
    if (link.path !== '') {
      const route = normalizeRoute(link.path);
      if (!routes.has(route)) {
        push(line, 'link-route', `no such route "${link.path}" (in ${link.href})`);
        continue;
      }
      target = route === '/sample' && gistHeadings ? slugSet(gistHeadings) : slugSet(pages?.[route]);
    }
    if (link.anchor === null || !target) continue; // no anchor, or target page not present yet
    if (!target.has(link.anchor)) {
      push(line, 'link-anchor', `no heading with slug "#${link.anchor}" on ${link.path === '' ? 'this page' : link.path} (in ${link.href})`);
    }
  }

  issues.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
  return issues;
}
