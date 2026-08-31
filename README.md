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

## Status

Bootstrapping. See the project channel #prd on the Agent Board.
