# PRD Field Guide

A showcase site for Burke Holland's PRD gist — *Build The Urlist* — that shows a
sample PRD, explains how to write one an AI agent can build from, and walks the
gist section by section as the worked example.

Source gist: https://gist.github.com/burkeholland/f71d1156812fd91e4369308358892817

## Layout (agreed conventions — keep these paths)

```
content/              authored markdown rendered by the site
  guide.md            How to write a PRD an agent can build from   -> /guide
  walkthrough.md      The sample PRD, section by section            -> /walkthrough
  template.md         Reusable PRD template (annotated)             -> /template
  gist/               snapshot of the gist + metadata               -> /sample
  gist/history/       every revision of the gist                    -> /history
  gist/history-notes.json  one hand-written sentence per revision, keyed by sha (the refresh never touches it)
public/               static files served as-is (mocks/, prd-template.md, favicon)
scripts/              zero-dependency Node scripts (fetch-gist) + node:test tests
src/                  Astro site (layouts, components, pages, styles)
  pages/history/[n].astro  one text-diff page per gist revision       -> /history/<n>
tests/                vitest unit tests and Playwright e2e
```

Content files carry YAML frontmatter with at least `title` and `description`.

## Ports

Dev servers for this project use **4410–4499**. Each task spec names its ports.
The defaults are **4410** (dev) and **4411** (preview / Playwright); set
`PREVIEW_PORT` to run the e2e suite's preview server on another port, e.g.
`$env:PREVIEW_PORT = '4431'; npm run test:e2e`.

## Develop

Astro 5, static output, strict TypeScript, npm. No UI or CSS framework, no web
fonts, no external requests at runtime. Markdown is loaded from the repo-root
`content/` folder through content collections (`src/content.config.ts`); when a
file is missing the matching page renders "Content is on its way." instead of
failing the build.

```
npm install            install dependencies (Playwright: npx playwright install chromium)
npm run dev            dev server on http://localhost:4410/prd/
npm run build          production build to dist/
npm run preview        serve dist/ on http://localhost:4411/prd/
npm run check          astro check (types, 0 errors expected)
npm test               vitest unit tests (tests/unit) + node:test script tests (scripts/**/*.test.mjs, scripts/check-*.mjs)
npm run test:unit      vitest alone
npm run test:e2e       Playwright, Chromium only (tests/e2e) — builds, then runs against preview on 4411
npx playwright test tests/e2e/a11y.spec.ts   axe-core (WCAG 2.1 AA) on every page, light + dark, plus keyboard path
npx playwright test tests/e2e/template.spec.ts   copy buttons on /template (clipboard, keyboard, other pages have none)
```

Ports: **4410** dev, **4411** preview / Playwright by default; `PREVIEW_PORT`
overrides the e2e preview port. The site lives under the `/prd` base path
locally too, so open `http://localhost:4410/prd/` — the bare `/` is not served.

Rendered markdown goes through two rehype plugins (`astro.config.mjs`):
`src/lib/rehype-base.mjs` prefixes root-relative URLs with the base, and
`src/lib/rehype-figures.mjs` turns each block-level image into a lazy-loaded
`<figure>` captioned from the nearest preceding `####` heading — this is how the
gist's screenshots render on `/sample`. The root `.gitattributes` marks
`content/gist/**` and `public/raw/**` `-text` so the CRLF gist snapshot stays
byte-exact on every checkout.

Styles live in `src/styles/global.css` (screen) and `src/styles/print.css` (`@media print`
only: the document pages print / save as PDF as content only, black on white, code wrapped,
external links followed by their URL; covered by `tests/e2e/print.spec.ts`).

Performance (Lighthouse; nothing to install, it reuses Playwright's Chromium; run against `npm run preview`):
`$env:CHROME_PATH = (node -e "console.log(require('playwright').chromium.executablePath())"); npx --yes lighthouse@latest http://localhost:4411/prd/ --chrome-flags="--headless=new" --output=json --output-path=lh.json --only-categories=performance,accessibility,best-practices,seo`
— add `--preset=desktop` for desktop and `--ignore-status-code` for the 404 page; the `EPERM` on Chrome's temp
profile at exit is harmless. Measured 2026-08-31 with Lighthouse 13.4.1 (HeadlessChrome 151), mobile and desktop:
perf 98–100, a11y 98–100, best-practices 100, SEO 100 on every page; the 404 page scores SEO 50 by design (it
returns 404 and is `noindex`). Never optimise `public/mocks/**` or `public/raw/**` in place — they are byte-verbatim
copies of the gist and the daily fetch workflow would revert the change; a lighter screenshot is a new derived copy.

## Deploy

Public URL: **https://burkeholland.github.io/prd/**

- Pages source = **GitHub Actions**, workflow `.github/workflows/deploy.yml`.
  Every push to `main` runs `npm ci`, `npm run check`, `npm test`,
  `npm run build` and publishes `dist/`; a parallel `e2e` job runs the
  Playwright suite on every push and the deploy waits for both (the two checks
  take about 75 s, the Pages deploy itself 10 s to 3 min). Browser failures
  appear as annotations on the run and the HTML report is attached to the run
  as an artifact for a week. Pushes to other branches run the same `build` and
  `e2e` jobs as CI and skip the deploy job. No secrets: Pages deploys with the
  workflow's own OIDC token.
- Base path: this is a *project* site, so every URL lives under **`/prd`**. The
  value is set once in `astro.config.mjs` (`base`, next to `site`). Only two
  places know it from there: `withBase()` in `src/lib/base.ts` (reads
  `import.meta.env.BASE_URL`; every internal `href`/`src` in `src/**` goes
  through it) and the rehype plugin `src/lib/rehype-base.mjs` (prefixes
  root-relative links and images inside rendered markdown, adding a trailing
  slash to page paths). Content in `content/` stays base-agnostic.
- Rollback: `git revert <merge commit>` and push to `main`, which redeploys the
  previous state; or rerun the last good deploy with
  `gh workflow run deploy.yml --ref main`.
- Custom domain later: set `base: '/'` and `site: 'https://<domain>'` in
  `astro.config.mjs`, add `public/CNAME` with the domain, and create one DNS
  record (CNAME to `burkeholland.github.io`). Nothing else changes.

## Social preview and sitemap

- Every page's `<head>` (`src/layouts/Base.astro`) has one `<link rel="canonical">`, Open Graph
  (`og:type/site_name/title/description/url/image/locale`) and Twitter (`summary_large_image`)
  tags built from its `title`/`description` props and `src/lib/seo.ts` (`canonicalUrl()`,
  `OG_IMAGE`). A `noindex` prop emits `robots: noindex` and drops the canonical and `og:url`.
- Preview image `public/og.png` (1200×630, < 200 KB) is rendered from `scripts/og.html`;
  regenerate with `npm ci && node scripts/make-og.mjs` and commit the PNG.
- `@astrojs/sitemap` writes `dist/sitemap-index.xml` + `sitemap-0.xml` (five pages, canonical
  form, no 404), linked from every page via `<link rel="sitemap">`. No `robots.txt`: crawlers
  never read one under a project-site path.
- `deploy.yml` pins the actions to their Node 24 majors (`checkout@v7`, `setup-node@v7`,
  `upload-pages-artifact@v5`, `deploy-pages@v5`); bump them together.
