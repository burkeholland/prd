# scripts/ — the Node (24+) scripts behind the site

Five of the seven need nothing but Node 24+ (the three gist scripts also shell out to the `git` binary): `fetch-gist.mjs`,
`fetch-gist-history.mjs`, `history-notes-missing.mjs`, `check-content.mjs` and `check-template.mjs` run on a bare clone —
`node scripts/fetch-gist.mjs` works before any `npm install`. The other two import devDependencies and stop with a
module-not-found error until those are installed: `make-mocks.mjs` needs `sharp` (the same build Astro's image service uses) and
`make-og.mjs` needs `@playwright/test` and its Chromium — `npm ci` first, plus `npx playwright install chromium` for make-og
when the browser is not installed yet. Each script's header comment says the same in more detail.

## fetch-gist.mjs — snapshot the sample PRD gist

`node scripts/fetch-gist.mjs` downloads Burke Holland's *Build The Urlist* gist and every screenshot it embeds (seven today —
the `images` list in `content/gist/meta.json`) so the site builds offline. Rerunning it with an unchanged gist changes nothing
(the previous `fetched_at` is kept while the content is identical). It writes:

- `public/raw/build-the-urlist.md` — the gist file **byte-for-byte verbatim** (the site's "Download .md")
- `content/gist/build-the-urlist.md` — same text, only the `<img>` sources rewritten to local `/mocks/NN-slug.png`
- `public/mocks/NN-slug.png` — the screenshots, validated (HTTP 200, PNG magic bytes, > 10 000 bytes)
- `content/gist/meta.json` — gist id/owner/revision/`updated_at`/`fetched_at` + the image list

Options: `--gist <id>`, `--out <repo root>`, `--owner <login>`, `--description <text>`, `--dry-run` (fetch + validate, write nothing).
Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.
Both scripts clone the gist's git repository (anonymous, ~1 s); the GitHub REST API is not used, so no token is needed.
Git does not record a gist's owner or description: `--owner`/`--description` set them, else they are carried over from the
existing `content/gist/meta.json` (default owner `burkeholland`, no description). The screenshots are plain HTTPS downloads.

Automatic refresh: the workflow **Refresh the sample PRD snapshot** (`.github/workflows/refresh-gist.yml`) reruns this
script and `fetch-gist-history.mjs` daily at 13:00 UTC. When the gist changed it pushes `gist-refresh/<revision>` and
opens a pull request (gist revision link, diff stat, a `Checks: pass` / `Checks: FAIL` line from `node --test`); it
never commits to `main`. By hand: `gh workflow run refresh-gist.yml -f dry_run=true` (fetch + diff only, no push, no PR).

Tests: `node --test "scripts/**/*.test.mjs"` — offline unit tests for `scripts/lib/gist.mjs` and `scripts/lib/gist-git.mjs`
(the thin git layer: `git clone`/`log`/`diff --numstat`/`cat-file blob`/`rev-parse`/`ls-tree`, tested by injecting the
command runner) plus one integration test over the committed snapshot (skips when it has not been generated yet).

## fetch-gist-history.mjs — every revision of the sample PRD

`node scripts/fetch-gist-history.mjs` clones the gist's git repository once (`--no-checkout`), reads the revision list
from `git log`, the +/- line counts of every revision from `git diff --numstat` (the first revision included) and the
`build-the-urlist.md` of every one from `git cat-file blob`, so the "how this PRD evolved" data is offline and reproducible.
Rerunning it with an unchanged gist changes nothing (`fetched_at` is kept while the content is identical);
snapshots of revisions that vanished from the gist are removed. It writes:

- `content/gist/history/NN-<short>.md` — the file at revision NN (01 = oldest), **byte-for-byte verbatim**
  (CRLF or LF as the gist had it — revisions 10–12 are LF; the script warns, never normalises)
- `content/gist/history.json` — `count`, `first_committed_at`/`last_committed_at`, `additions_total`/`deletions_total`
  and per revision `n`, `version`, `short`, `committed_at`, `additions`/`deletions`/`total`, `url`, `file`, `bytes`, `lines`

Every snapshot must be non-empty UTF-8 starting with the gist's `# ` h1, else nothing is written.
Options: `--gist <id>`, `--out <repo root>`, `--owner <login>` (for the revision URLs; default: `meta.json`, else `burkeholland`),
`--dry-run` (fetch + validate, print the plan, write nothing).
Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.
Both scripts clone the gist's git repository (anonymous, ~1 s); the GitHub REST API is not used, so no token is needed.
Pure helpers: `scripts/lib/history.mjs` (`history.test.mjs` also checks the committed data: `count` = files on disk,
recorded `bytes`, and the snapshot matching `meta.json`'s `revision` byte-identical to `public/raw/build-the-urlist.md`).

## history-notes-missing.mjs — what changed in each gist revision that has no note yet

`npm run notes:missing` (= `node scripts/history-notes-missing.mjs [--root <repo root>] [--history <path>] [--notes <path>]`)
tells the note-writer exactly what changed in every revision of the gist that has no hand-written history note yet. It reads
`content/gist/history.json` (the revision list), `content/gist/history-notes.json` (`{ notes: { <sha>: <sentence> } }`), the
snapshots `content/gist/history/NN-<short>.md` named there and `content/gist/meta.json` (for the file name), and prints one
block per revision whose full `version` sha has no non-empty note: `Revision N of T — <committed_at> — +A −D — sha <short>…`,
the full sha, `Previous revision: N-1 (sha …)`, then `--- diff of build-the-urlist.md, revision N-1 → N ---` and the unified diff
of the two snapshot files (`git diff --no-index --unified=3`, with the `diff --git` and `index` header lines dropped so each block
starts at `---`/`+++`). The first revision has no predecessor: `First revision — no diff.` Blocks and the closing summary go to
stdout, only errors to stderr; it writes nothing.
Flags (each optional): `--root <dir>` (repo root the snapshot paths in `history.json` are relative to; default: this repo),
`--history <path>`, `--notes <path>` (point it at a copy to preview what a missing note would print), `-h, --help`.
Exit codes: 0 every revision has a note (`All 16 revisions have a note.` today) · 1 at least one revision is missing a note (the
blocks were printed) · 2 usage or unreadable input.
No shebang on purpose: `tests/unit/history-notes-missing.test.ts` imports it through Vite, which does not strip one. What to do
with the output — the daily refresh PR stays red until every sha has its sentence — is the root README's
[When the gist changes](../README.md#when-the-gist-changes).

## check-content.mjs — every quote verbatim, every link resolvable

`node --test scripts/check-content.mjs` checks each top-level `content/*.md`: frontmatter (`title`, `description`, integer `order`),
no `#` h1 in the body, every blockquote an exact excerpt of `public/raw/build-the-urlist.md` (whitespace-insensitive, split on
`…`/`...`/`[…]`; opt out with `<!-- quote: not-gist -->` on the line above) and every `](/…)`/`](#…)` link a known route + heading slug.
Failures list `file:line kind — message`. Another checkout: `CONTENT_ROOT=<dir>` or `node scripts/check-content.mjs --root <dir>`.
Pure helpers: `scripts/lib/content.mjs` (unit tests in `content.test.mjs`, run by the `node --test` glob above).

## check-template.mjs — the template page and its clean download describe the same skeleton

`node --test scripts/check-template.mjs` (9 tests, also run by `npm test`) reads `content/template.md` (the annotated `/template`
page) and `public/prd-template.md` (the clean download) and checks that both describe the same 14-section skeleton: the annotated
page has exactly 14 section h2s before `## Before you hand it over`, each with `**Write here:**`, `**Example from the sample:**`
and `**Skeleton:**` once and in that order, a blockquote under the example label and exactly one ```md block; the clean file has
the same 14 h2s in the same order, each one `<!-- … -->` instruction comment plus that section's skeleton verbatim, starts with
`# Build {Product Name}` (its only h1, no frontmatter), keeps the `- [ ] Requirement — Verify: method` checkbox format and a routes
table with a `/{vanity}` row, is 120–220 lines long, and every `{placeholder}` in it appears on the annotated page. Line endings
are normalised before comparing, so CRLF checkouts pass. No flags, no environment variables (both paths are fixed relative to the
script); it writes nothing. Exit code: `node --test`'s — 0 when every test passes, 1 when any fails.

## make-mocks.mjs — lighter WebP copies of the screenshots

`node scripts/make-mocks.mjs [--force] [--src <dir>] [--out <dir>]` derives lighter WebP copies of the gist screenshots so `/sample`
can serve them through `<picture>` (`src/lib/rehype-figures.mjs`) with the original PNG as the fallback. It runs by itself as
`prebuild` / `predev` in `package.json`, i.e. before every `npm run build` and `npm run dev` (and before `astro check` in
`.github/workflows/deploy.yml`), so there is nothing to commit and nothing that can go stale. For every `public/mocks/*.png` it writes
`public/mocks/derived/<stem>-760.webp` and `public/mocks/derived/<stem>-1320.webp` (resized, never enlarged; lossy WebP at
quality 85 — roughly a fifth of the PNG bytes with the UI text still crisp). `public/mocks/derived/` is gitignored; it never writes
into `public/mocks/` itself, whose PNGs are byte-verbatim copies of the gist that `fetch-gist.mjs` overwrites. A derived file whose
mtime is not older than its source is left alone (`--force` rewrites everything); `--src`/`--out` point it at other directories.
One line per derived file, `written` / `up to date` and its size in bytes — 14 files today.
Exit codes: 0 ok · 1 a source ended up without both derived files, `--src` holds no PNG, or `sharp` failed (or is not installed).
Needs `sharp` (devDependency, the same build Astro's image service uses) — `npm ci` first. Tests: `scripts/make-mocks.test.mjs`
(next to it, not in `lib/`; in the `npm test` glob) cover the naming, the skip decision and a real run in a temp dir.

## make-og.mjs + og.html — the social preview cards

`node scripts/make-og.mjs` (from the repo root) renders `scripts/og.html` once per entry of `SOCIAL_CARDS` in `src/lib/seo.ts` —
six cards today: `public/og.png` for the home page and `public/og/sample.png`, `public/og/guide.png`, `public/og/walkthrough.png`,
`public/og/history.png`, `public/og/template.png` — the 1200×630 PNGs the pages point at as `og:image` / `twitter:image`
(`src/layouts/Base.astro`). The text comes from `SITE` (`src/lib/site.ts`) and `SOCIAL_CARDS` (Node 24 strips the types), so the
images cannot drift from the site copy: the home card keeps title = `SITE.name` and no eyebrow, the page cards put `SITE.name` in
the eyebrow, the card title in the h1 and its subtitle in the tagline; copy that would wrap the title past two lines or the
subtitle past three is shrunk (title down to 48 px, subtitle down to 24 px), never cut. It prints one line per file, e.g.
`public/og/guide.png 1200×630, 44.6 KB (title 1 line at 104px, subtitle 2 lines at 38px)`.
Exit codes: 0 ok · 1 any image is not 1200×630, weighs 200 KB or more (the e2e suite asserts the same limits) or its copy overflows
the card. No flags: it always renders every card, there is no way to render just one. **Commit the regenerated PNGs** — they are
tracked; a rerun with unchanged copy and `og.html` reproduced all six byte for byte here (`git status --short public/` stayed clean).
`scripts/og.html` is the card's source — inline CSS only, system fonts, no external requests, colours from the dark theme in
`src/styles/global.css`; the script fills its `#eyebrow`, `#title` and `#tagline` slots. Edit it, then regenerate.
Needs the project's dependencies (`@playwright/test` and its Chromium): `npm ci` first, and `npx playwright install chromium` if
the browser is not installed yet.

## lib/ — the helpers the scripts import

`scripts/lib/gist.mjs` (pick the gist file, extract and rewrite the screenshot `<img>`s, build `meta.json`), `scripts/lib/gist-git.mjs`
(the thin layer over the `git` binary — `clone --no-checkout`, `log`, `diff --numstat`, `cat-file blob`, `rev-parse`, `ls-tree` —
every call an args array, never a shell string), `scripts/lib/history.mjs` (revision records, snapshot names, the `history.json`
document) and `scripts/lib/content.mjs` (frontmatter, blockquotes, headings with GitHub slugs, internal links, `checkFile`). Only
`gist-git.mjs` does I/O, and it takes an injected command runner, so each has its offline `*.test.mjs` next to it (`gist.test.mjs`
and `history.test.mjs` also carry one integration test each over the committed snapshot, skipped while it is not generated yet).
`npm test` runs them: it is `vitest run && node --test "scripts/**/*.test.mjs" "scripts/check-*.mjs"` (`package.json`
`scripts.test`) — the first glob picks up the four helper suites plus `scripts/make-mocks.test.mjs` (42 tests), the second the two
check scripts (13), after the vitest unit tests of `src/lib`. The node:test half alone, no `npm install` needed except for the
`make-mocks.test.mjs` run (it needs `sharp`): `node --test "scripts/**/*.test.mjs" "scripts/check-*.mjs"`.
