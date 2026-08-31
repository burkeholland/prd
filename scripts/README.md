# scripts/ — zero-dependency Node (24+) scripts, no `npm install` needed

## fetch-gist.mjs — snapshot the sample PRD gist

`node scripts/fetch-gist.mjs` downloads Burke Holland's *Build The Urlist* gist and its seven
screenshots so the site builds offline. Rerunning it with an unchanged gist changes nothing
(the previous `fetched_at` is kept while the content is identical). It writes:

- `public/raw/build-the-urlist.md` — the gist file **byte-for-byte verbatim** (the site's "Download .md")
- `content/gist/build-the-urlist.md` — same text, only the `<img>` sources rewritten to local `/mocks/NN-slug.png`
- `public/mocks/NN-slug.png` — the screenshots, validated (HTTP 200, PNG magic bytes, > 10 000 bytes)
- `content/gist/meta.json` — gist id/owner/revision/`updated_at`/`fetched_at` + the image list

Options: `--gist <id>`, `--out <repo root>`, `--dry-run` (fetch + validate, write nothing).
Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.
Set `GITHUB_TOKEN` to raise the unauthenticated GitHub API limit (60 requests/hour); it is never printed.

Automatic refresh: the workflow **Refresh the sample PRD snapshot** (`.github/workflows/refresh-gist.yml`) reruns this
script and `fetch-gist-history.mjs` daily at 13:00 UTC. When the gist changed it pushes `gist-refresh/<revision>` and
opens a pull request (gist revision link, diff stat, a `Checks: pass` / `Checks: FAIL` line from `node --test`); it
never commits to `main`. By hand: `gh workflow run refresh-gist.yml -f dry_run=true` (fetch + diff only, no push, no PR).

Tests: `node --test "scripts/**/*.test.mjs"` — offline unit tests for `scripts/lib/gist.mjs` plus one
integration test over the committed snapshot (skips when it has not been generated yet).

## fetch-gist-history.mjs — every revision of the sample PRD

`node scripts/fetch-gist-history.mjs` fetches the gist's revision list (`GET /gists/<id>`), then each
revision (`GET /gists/<id>/<version>`, sequential, 17 requests for 16 revisions) and keeps the
`build-the-urlist.md` of every one, so the "how this PRD evolved" data is offline and reproducible.
Rerunning it with an unchanged gist changes nothing (`fetched_at` is kept while the content is identical);
snapshots of revisions that vanished from the gist are removed. It writes:

- `content/gist/history/NN-<short>.md` — the file at revision NN (01 = oldest), **byte-for-byte verbatim**
  (CRLF or LF as the gist had it — revisions 10–12 are LF; the script warns, never normalises)
- `content/gist/history.json` — `count`, `first_committed_at`/`last_committed_at`, `additions_total`/`deletions_total`
  and per revision `n`, `version`, `short`, `committed_at`, `additions`/`deletions`/`total`, `url`, `file`, `bytes`, `lines`

Every snapshot must be non-empty UTF-8 starting with the gist's `# ` h1, else nothing is written.
Options: `--gist <id>`, `--out <repo root>`, `--dry-run` (fetch + validate, print the plan, write nothing).
Exit codes: 0 ok · 1 fetch/validation failure (nothing partial is written) · 2 usage.
A 403/429 stops the run with a hint to set `GITHUB_TOKEN` (60 unauthenticated requests/hour); it is never printed.
Pure helpers: `scripts/lib/history.mjs` (`history.test.mjs` also checks the committed data: `count` = files on disk,
recorded `bytes`, and the snapshot matching `meta.json`'s `revision` byte-identical to `public/raw/build-the-urlist.md`).

## check-content.mjs — every quote verbatim, every link resolvable

`node --test scripts/check-content.mjs` checks each top-level `content/*.md`: frontmatter (`title`, `description`, integer `order`),
no `#` h1 in the body, every blockquote an exact excerpt of `public/raw/build-the-urlist.md` (whitespace-insensitive, split on
`…`/`...`/`[…]`; opt out with `<!-- quote: not-gist -->` on the line above) and every `](/…)`/`](#…)` link a known route + heading slug.
Failures list `file:line kind — message`. Another checkout: `CONTENT_ROOT=<dir>` or `node scripts/check-content.mjs --root <dir>`.
Pure helpers: `scripts/lib/content.mjs` (unit tests in `content.test.mjs`, run by the `node --test` glob above).
