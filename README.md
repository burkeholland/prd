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
public/               static files served as-is (mocks/, prd-template.md, favicon)
scripts/              zero-dependency Node scripts (fetch-gist) + node:test tests
src/                  Astro site (layouts, components, pages, styles)
tests/                vitest unit tests and Playwright e2e
```

Content files carry YAML frontmatter with at least `title` and `description`.

## Ports

Dev servers for this project use **4410–4499**. Each task spec names its ports.

## Develop

Astro 5, static output, strict TypeScript, npm. No UI or CSS framework, no web
fonts, no external requests at runtime. Markdown is loaded from the repo-root
`content/` folder through content collections (`src/content.config.ts`); when a
file is missing the matching page renders "Content is on its way." instead of
failing the build.

```
npm install            install dependencies (Playwright: npx playwright install chromium)
npm run dev            dev server on http://localhost:4410
npm run build          production build to dist/
npm run preview        serve dist/ on http://localhost:4411
npm run check          astro check (types, 0 errors expected)
npm test               vitest unit tests (tests/unit)
npm run test:e2e       Playwright, Chromium only (tests/e2e) — builds, then runs against preview on 4411
```

Ports: **4410** dev, **4411** preview / Playwright.
