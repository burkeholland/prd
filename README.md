# PRD Field Guide

A showcase site for Burke Holland's PRD gist — *Build The Urlist* — that shows a
sample PRD, explains how to write one an AI agent can build from, walks the
gist section by section as the worked example, shows how the gist evolved
revision by revision, and offers a reusable template.

Source gist: https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817

## Layout (agreed conventions — keep these paths)

```
content/              authored markdown rendered by the site
  guide.md            How to write a PRD an agent can build from   -> /guide
  walkthrough.md      The sample PRD, section by section            -> /walkthrough
  template.md         Reusable PRD template (annotated)             -> /template
  gist/               snapshot of the gist: build-the-urlist.md + meta.json  -> /sample
  gist/history/       every revision of the gist (NN-<sha>.md; gist/history.json indexes them) -> /history
  gist/history-notes.json  one hand-written sentence per revision, keyed by sha (the refresh never touches it)
public/               static files served as-is (favicon.svg, prd-template.md = the clean template download)
  raw/                the gist file byte-for-byte verbatim (the "Download .md" on /sample)
  mocks/              the gist's screenshots, byte-verbatim (never optimise them in place)
  mocks/derived/      WebP copies derived by scripts/make-mocks.mjs before every build and dev run (gitignored)
  og.png, og/         social preview cards, home + one per page, rendered by scripts/make-og.mjs (committed)
scripts/              Node scripts + their node:test tests (each one documented in scripts/README.md)
  fetch-gist*.mjs     snapshot the gist and every revision of it (git clone, no token; the daily refresh runs both)
  check-*.mjs         node:test checks: content quotes verbatim and links resolvable; template.md = prd-template.md
  make-mocks.mjs      WebP copies of the screenshots (sharp), run as prebuild/predev
  make-og.mjs, og.html  render the social preview cards with Playwright's Chromium
  preview.mjs           Astro preview with the standard DOCX MIME type added
  lib/                pure helpers (gist, gist-git, history, content) + their *.test.mjs
src/                  Astro site
  layouts/            Base.astro (head, nav, footer) and Doc.astro (a markdown document + its table of contents)
  components/         Nav, Footer, Toc
  pages/              one .astro per route: index, create, sample, guide, walkthrough, history, template, 404
  pages/downloads/    prerendered Markdown, DOCX, and PDF blank-template files -> /downloads/prd-template.*
  pages/history/[n].astro  one text-diff page per gist revision       -> /history/<n>
  lib/*.ts            base (withBase), site (SITE, NAV, routes), seo (canonical URL + social cards), toc, diff, history, history-notes
  lib/rehype-*.mjs    the three rehype plugins (base, figures, anchors) — see Develop
  styles/             global.css (screen) and print.css (@media print)
  content.config.ts   content collections over the repo-root content/
tests/                vitest unit tests of src/lib (unit/*.test.ts) and Playwright e2e (e2e/*.spec.ts)
```

Content files carry YAML frontmatter with at least `title` and `description`.

## Ports

Dev servers for this project use **4410–4499**. Each task spec names its ports.
The defaults are **4410** (dev) and **4411** (preview / Playwright); set
`PREVIEW_PORT` to run the e2e suite's preview server on another port, e.g.
`$env:PREVIEW_PORT = '4431'; npm run test:e2e`.

## Develop

Astro 5, static output, strict TypeScript, npm. No UI or CSS framework, no web
fonts, and no external requests at runtime. JavaScript is page-scoped: copy actions
on `/template/` and `/sample/`, plus the local draft editor and in-browser downloads
on `/create/`. Markdown is loaded from the repo-root
`content/` folder through content collections (`src/content.config.ts`); when a
file is missing the matching page renders "Content is on its way." instead of
failing the build.

PRD exports use `docx` for valid Office Open XML packages and `pdf-lib` with
`@pdf-lib/fontkit` for paginated PDFs. The Latin Noto Sans files from
`@fontsource/noto-sans` are embedded in PDFs for selectable Unicode text; they are
not used as site fonts. `jszip` is a development-only parser for DOCX integrity
tests. Astro prerenders the three blank files during every build.

```
npm install            install dependencies (Playwright: npx playwright install chromium)
npm run dev            dev server on http://localhost:4410/prd/ (predev derives the WebP mocks first)
npm run build          production build to dist/ (prebuild derives the WebP mocks first)
npm run preview        serve dist/ on http://localhost:4411/prd/
npm run check          astro check (types, 0 errors expected)
npm test               vitest unit tests (tests/unit) + node:test script tests (scripts/**/*.test.mjs, scripts/check-*.mjs)
npm run test:unit      vitest alone
npm run test:e2e       Playwright, Chromium only (tests/e2e) — builds, then runs against preview on 4411 (PREVIEW_PORT overrides)
                       PW_ENGINES=all adds the opt-in webkit and firefox projects (e.g. `$env:PW_ENGINES = 'all'; npx playwright test --project=webkit`); a few Chromium-only tests (clipboard, axe, page.pdf, WebKit's Tab-to-links) skip there by design
npx playwright test tests/e2e/a11y.spec.ts   axe-core (WCAG 2.1 AA) on every page, light + dark, plus keyboard path
npx playwright test tests/e2e/links.spec.ts   every in-site link answers 200 and every #anchor exists on its page
npx playwright test tests/e2e/template.spec.ts   copy buttons on /template (clipboard, keyboard, other pages have none)
npx playwright test tests/e2e/sample.spec.ts   "Copy the PRD" on /sample (clipboard, keyboard, failure path)
npx playwright test tests/e2e/site.spec.ts   every route: titles, nav, base-prefixed URLs, the sample's screenshots and download, the history table
npx playwright test tests/e2e/anchors.spec.ts   every h2–h4 links to its own id (hover #, keyboard, TOC ids, print)
npx playwright test tests/e2e/meta.spec.ts   canonical URL + Open Graph/Twitter tags per page, the og PNGs (1200×630, < 200 KB), the sitemap
npx playwright test tests/e2e/diffs.spec.ts   /history/<n>: first draft as preview, diff tables, line-ending note, noindex, no script
npx playwright test tests/e2e/print.spec.ts   the document pages print content only, black on white; /sample saves as an A4 PDF
```

`build` and `dev` pass `--force` so a change to a remark/rehype plugin is never served from
Astro's content cache (`node_modules/.astro/data-store.json`, shared between worktrees).

Ports: **4410** dev, **4411** preview / Playwright by default; `PREVIEW_PORT`
overrides the e2e preview port. The site lives under the `/prd` base path
locally too, so open `http://localhost:4410/prd/` — the bare `/` is not served.

Rendered markdown goes through four rehype plugins (`astro.config.mjs`), three of them
ours: `src/lib/rehype-base.mjs` prefixes root-relative URLs with the base;
`src/lib/rehype-figures.mjs` turns each block-level image into a `<figure>` captioned
from the nearest preceding `####` heading, serving the WebP copy through `<picture>`
with the PNG as fallback, the first one eager and the rest lazy-loaded — this is how the
gist's screenshots render on `/sample`; Astro's own `rehypeHeadingIds` then gives every
heading its id (listed explicitly so it runs before the last plugin rather than after all
of them); and `src/lib/rehype-anchors.mjs` wraps each h2–h4 in a link to its own id. The
root `.gitattributes` marks `content/gist/**` and `public/raw/**` `-text` so the CRLF
gist snapshot stays byte-exact on every checkout.

Styles live in `src/styles/global.css` (screen) and `src/styles/print.css` (`@media print`
only: the document pages print / save as PDF as content only, black on white, code wrapped,
external links followed by their URL; covered by `tests/e2e/print.spec.ts`).

Performance (Lighthouse; nothing to install, it reuses Playwright's Chromium; run against `npm run preview`):
`$env:CHROME_PATH = (node -e "console.log(require('playwright').chromium.executablePath())"); npx --yes lighthouse@latest http://localhost:4411/prd/ --chrome-flags="--headless=new" --output=json --output-path=lh.json --only-categories=performance,accessibility,best-practices,seo`
— add `--preset=desktop` for desktop and `--ignore-status-code` for the 404 page; the `EPERM` on Chrome's temp
profile at exit is harmless. Measured 2026-08-31 with Lighthouse 13.4.1 (HeadlessChrome 151), mobile and desktop, after
the WebP screenshots, section permalinks and the `/sample` copy button landed: perf 99–100, a11y 98–100, best-practices
100, SEO 100 on every content page; `/sample` on a phone is 207 KB instead of 1.1 MB (perf 96–98 → 100, the image
opportunity gone bar a zero-weight "responsive size" note on the 760-px WebPs); the `/history/<n>/` diff pages score
perf 96 on mobile (throttled layout of a ~4,800-element table, no JS) and SEO 60 because they are `noindex`; the 404
page scores SEO 50 by design (it returns 404 and is `noindex`). Never optimise `public/mocks/**` or `public/raw/**` in
place — they are byte-verbatim copies of the gist and the daily fetch workflow would revert the change; instead
`npm run build` (via `prebuild`) derives 760/1320-px WebP copies into `public/mocks/derived/` with
`scripts/make-mocks.mjs` and `rehype-figures` serves them through `<picture>` with the PNG as fallback; the first
screenshot loads eagerly.

## Deploy

Public URL: **https://burkeholland.github.io/prd/**

- Pages source = **GitHub Actions**, workflow `.github/workflows/deploy.yml`.
  Three jobs run on every push. `build`: `npm ci`, `node scripts/make-mocks.mjs`,
  `npm run check`, `npm test`, `npm run build`, then uploads `dist/` as a
  one-day `dist` workflow artifact. `e2e`, a matrix of three legs (chromium,
  webkit, firefox; `fail-fast: false`, so one engine's red never hides the
  others), downloads that artifact and runs the Playwright suite against it
  (`PLAYWRIGHT_PREBUILT=1` makes the suite's web server serve the downloaded
  build instead of building its own; `PW_ENGINES=all` defines the webkit and
  firefox projects). `deploy` downloads the same artifact and hands it to Pages
  only after all three legs passed — nothing after `build` runs `astro build`
  again, so the site cannot publish a build the browser suite did not run
  against. `make-mocks` runs before `astro check` because `check` runs
  `astro sync`, which renders the markdown into the content-layer cache that
  `astro build` reuses, so the WebP copies must exist before that first render.
  Measured 2026-09-01: `build` 31 s (`npm ci` 5 s, `check` 8 s, unit tests 2 s,
  build 3 s, upload 2 s); each leg 80–100 s (`npm ci` 5 s, browser install
  22–36 s on a cold cache, suite 40–50 s), the three in parallel — about 2½ min
  from push to the deploy gate — and the Pages deploy itself 10 s to 3 min.
  Browser failures appear as annotations on the run and each leg's HTML report
  is attached to the run as `playwright-report-<engine>` for a week. Pushes to
  other branches run `build` and the three legs as CI and skip the deploy job.
  No secrets: Pages deploys with the workflow's own OIDC token. Runs are
  serialised per branch (`concurrency: pages-<ref>`), so a branch push can
  never cancel a pending `main` deploy.
- `deploy.yml` pins the actions to their Node 24 majors (`checkout@v7`, `setup-node@v7`,
  `cache@v6`, `upload-artifact@v7`, `download-artifact@v7`, `upload-pages-artifact@v5`,
  `deploy-pages@v5`); bump them together.
- `/build.json` is the build stamp — `{ "sha", "builtAt" }`, prerendered by
  `src/pages/build.json.ts` from `GITHUB_SHA` (`"local"` outside Actions) and the
  build clock. After `deploy-pages` the `deploy` job polls the live
  `/prd/build.json` (cache-busted, every 5 s, up to 3 minutes) until its `sha`
  is the commit it just deployed, so a green run means the published site *is*
  that build. A red `deploy` job whose `Verify the live site serves this commit`
  step failed means Pages is still serving an older build — the log lists each
  attempt's sha next to the expected one — so re-run the job before suspecting
  the build.
- Base path: this is a *project* site, so every URL lives under **`/prd`**. The
  value is set once in `astro.config.mjs` (`base`, next to `site`). Only three
  places read it from there: `withBase()` in `src/lib/base.ts` (reads
  `import.meta.env.BASE_URL`; every internal `href`/`src` in `src/**` goes
  through it), `src/layouts/Base.astro` (passes `import.meta.env.BASE_URL` to
  `socialCard()` so the page path can be matched to its preview card) and the
  rehype plugin `src/lib/rehype-base.mjs` (prefixes
  root-relative links and images inside rendered markdown, adding a trailing
  slash to page paths). Content in `content/` stays base-agnostic.
- Rollback: `git revert <merge commit>` and push to `main`, which redeploys the
  previous state; or rerun the last good deploy with
  `gh workflow run deploy.yml --ref main`.
- Custom domain later: set `base: '/'` and `site: 'https://<domain>'` in
  `astro.config.mjs`, add `public/CNAME` with the domain, and create one DNS
  record (CNAME to `burkeholland.github.io`). Nothing else changes.

### When the gist changes

- The primary `refresh-gist.yml` schedule runs at 13:23 UTC, and a backup checks
  again at 15:47 UTC. Both deliberately use odd minutes to avoid the top of the
  hour, though GitHub may still delay or drop scheduled runs under load. Each
  re-snapshots the gist and, when a new revision exists, opens a pull request
  from `gist-refresh/<sha>`. Its CI is red on `tests/unit/history-notes.test.ts`
  until that revision has a note in `content/gist/history-notes.json` — that is
  the intended gate, not a flake. If both scheduled checks are skipped,
  `gh workflow run refresh-gist.yml --ref main` does the same thing.
- `npm run notes:missing` prints each un-annotated revision — number, date,
  `+/−` counts, full sha, previous sha — followed by the unified diff of the PRD
  markdown between it and the previous revision (exit 1 while anything is
  missing, `All N revisions have a note.` and exit 0 otherwise).
- Add one sentence per sha to `content/gist/history-notes.json`, in the house
  style the test enforces: one sentence, 60–160 characters, ends with a period,
  no "the model", no line counts. Run `npm test`, then push to the same
  `gist-refresh/<sha>` branch; the PR goes green and can be merged.

## Social preview and sitemap

- Every page's `<head>` (`src/layouts/Base.astro`) has one `<link rel="canonical">`, Open Graph
  (`og:type/site_name/title/description/url/image/locale`) and Twitter (`summary_large_image`)
  tags built from its `title`/`description` props and `src/lib/seo.ts` (`canonicalUrl()`,
  `socialCard()`, `OG_IMAGE`). A `noindex` prop emits `robots: noindex` and drops the canonical and `og:url`.
- Preview images `public/og.png` (home) and `public/og/*.png` (one per page, from `SOCIAL_CARDS`
  in `src/lib/seo.ts`; 1200×630, < 200 KB each) are rendered from `scripts/og.html`; regenerate
  with `npm ci && node scripts/make-og.mjs` and commit the PNGs.
- `@astrojs/sitemap` writes `dist/sitemap-index.xml` + `sitemap-0.xml` (six pages, canonical
  form; no 404 and no `/history/<n>/` diff pages), linked from every page via `<link rel="sitemap">`. No `robots.txt`: crawlers
  never read one under a project-site path.
