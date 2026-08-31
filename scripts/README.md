# scripts/

Zero-dependency Node (24+) scripts. No `npm install` needed.

## fetch-gist.mjs — snapshot the sample PRD gist

`node scripts/fetch-gist.mjs` downloads Burke Holland's *Build The Urlist* gist and its
seven screenshots so the site builds offline. It is idempotent; rerunning it with an
unchanged gist changes nothing (the previous `fetched_at` is kept when the content is identical).

| Output                                | What it is                                                              |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `public/raw/build-the-urlist.md`      | the gist file **byte-for-byte verbatim** (the site's "Download .md")    |
| `content/gist/build-the-urlist.md`    | same text, only the `<img>` sources rewritten to local `/mocks/NN-slug.png` |
| `public/mocks/NN-slug.png`            | the screenshots, validated (HTTP 200, PNG magic bytes, > 10 000 bytes)  |
| `content/gist/meta.json`              | gist id/owner/revision/`updated_at`/`fetched_at` + the image list        |

Options: `--gist <id>`, `--out <repo root>`, `--dry-run` (fetch + validate, write nothing).
Exit codes: 0 ok, 1 fetch/validation failure (nothing partial is written), 2 usage.
Set `GITHUB_TOKEN` to raise the unauthenticated GitHub API limit (60 requests/hour); it is never printed.

## Tests

`node --test "scripts/**/*.test.mjs"` — offline unit tests for `scripts/lib/gist.mjs` plus one
integration test over the committed snapshot (skips when it has not been generated).
