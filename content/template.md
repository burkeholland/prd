---
title: "PRD template"
description: "The skeleton of a PRD an agent can build from — copy it, keep the order, fill every section."
order: 4
---

The sample's skeleton: its sections in its order, each with a rule, a line from [the sample](/sample), and a copyable block. The [guide](/guide) names the habits behind them, and the [walkthrough](/walkthrough) shows each in use.

To use it: keep the section order, delete nothing without deciding it does not apply, replace every `{…}` placeholder starting with `{Product Name}`, and never leave a section saying "TBD". [Download the clean template](/prd-template.md), or copy the skeletons below.

This template follows the order of the sample's seventeen sections, with its opening paragraph given a Mission section of its own, its Navigation bar subsection promoted to a section, its five screen sections (Home page, Draft and editor, My Lists, Delete, Public list) folded into one Screens section, its two data sections (Live metadata, Aliases and publication) folded into Data and integrations, and Login and ownership renamed Identity and ownership — fourteen in all.

## Mission and stop condition

**Write here:** One paragraph, first, directly under the title as in the sample: what to build, where, and when to stop. Without a stop condition the agent decides what counts as done.

**Example from the sample:**

> Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.

**Skeleton:**

```md
Build the complete {Product Name} application in this repository. Work autonomously from start to finish and stop only when the app is complete.
```

## Mocks

**Write here:** One named h4 per screen and per visible state — validation, empty, signed in and out — each with a screenshot. A mock settles layout; prose leaves it to be guessed.

**Example from the sample:**

> `#### New List: Validation States`

**Skeleton:**

```md
#### {Screen name}

<img alt="{Screen name}" src="{screenshot URL or path}" />

#### {Screen name}: {State}

<img alt="{Screen name}: {State}" src="{screenshot URL or path}" />
```

## Technical specification and checklist

**Write here:** Make the agent write its own spec and checklist before coding, and give the checkbox format exactly. Every requirement then carries a verification method: "done" is proven, not declared.

**Example from the sample:**

> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it.

**Skeleton:**

```md
Before coding, create and commit `TECHNICAL_SPEC.md`: architecture, data model, routes/API, security boundaries, key assumptions, and an atomic Markdown checkbox for every requirement in this document, grouped by feature, each with a verification method.

Use the format `- [ ] Requirement — Verify: method`. Check an item only after its verification passes; reopen it if later work breaks it. Before finishing, resolve every unchecked item or report the exact blocker.
```

## Stack and design

**Write here:** Pin every layer by name and name what you are ruling out ("no ORM", "no second CSS framework"). Each unpinned layer is a decision the agent makes silently.

**Example from the sample:**

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM

**Skeleton:**

```md
Use:

- {Framework}, {language and strictness}, {runtime}, and {package manager}
- {Database} with {access method}; no {ruled-out alternative}
- {Unit test runner} and {browser test runner}
- Current stable package versions and a committed `{lockfile}`

Design system: {CSS framework} for every screen, {icon set} for all icons; no second CSS framework.
```

## Product

**Write here:** What it is, who can do what, invariants as plain rules, and what does *not* exist, exact strings in bold. An agent not told "no soft delete" will often build one.

**Example from the sample:**

> Deletion is **permanent**: the list's alias becomes immediately available to anyone. There is no soft delete, restore, tombstone, or anonymous list in this product.

**Skeleton:**

```md
{Product Name} lets {who} {do what} and {publish or share it how}.

{Action} requires {condition}. The {button} button reads **"{exact label while blocked}"** and is disabled until then. {Ownership rule}. {Destructive action} is **permanent**: {what becomes true immediately}. There is no {thing that does not exist} in this product.

Anyone can {public capability}.

The server is authoritative: revalidate {input, ownership, and uniqueness} on every write; ignore client-supplied {owner IDs}.
```

## Routes

**Write here:** A table of every route, the reserved first segments, and the 404 text in bold. Nothing is implied; the catch-all row says how many segments it swallows.

**Example from the sample:**

> | `/{vanity}` | Public list — **a single path segment only** |
> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**

**Skeleton:**

```md
| Route | Behavior |
|---|---|
| `/` | {Home page} |
| `/{segment}/{page}` | {What it shows, and who may see it} |
| `/{vanity}` | Public {item} — **a single path segment only** |

404 page (everything else, including multi-segment paths): show the text **"{exact 404 message}"**.

Static routes take priority over `/{vanity}`. Reserved first segments: `{segment}`, `api`, `__test`.
```

## Navigation

**Write here:** Items in order with exact labels, when each shows or hides, both states of the right side, and the unsaved-work guard with its exact modal strings.

**Example from the sample:**

> 1. `New` — a "create/add" icon
> 2. `My Lists` — a "user/account" icon — **only when signed in**

**Skeleton:**

```md
A navbar. Left: {brand or logo} (alt "{alt text}"). Menu items in this order, each an icon plus label:

1. `{Item}` — {icon}
2. `{Item}` — {icon} — **only when {condition}**
3. `{Item}` — link to `{URL or route}`, {icon}

Right: {controls, in order}; signed out: {login control}; signed in: {user identity and menu}.

Clicking `{Item}` while {state that would lose work} pops a confirm modal: title **"{exact title}"**, prompt **"{exact prompt}"**, OK/Cancel.

Document title: "{exact document title}".
```

## Screens

**Write here:** One h3 per screen: regions top to bottom, every string bold and exact, each control with placeholder, validation rule, and error text, every loading and empty state. Numbers, not adjectives.

**Example from the sample:**

> - Helper text above the input (left-aligned, regular-weight body text — not a small bold form label): **"Enter a link and press enter"**

**Skeleton:**

```md
### {Screen name}

{Layout: regions top to bottom, desktop columns, what stacks or hides on mobile.}

- {Element}: {exact text, size, weight, color, alignment}
- {Control}: placeholder `{exact placeholder}`; validation: {rule}; on invalid show **"{exact error}"**; on valid {result}
- {State}: {loading, empty, or error state and its exact text}

### {Screen name}

{Layout in one paragraph.}

- {Element}: {exact text and appearance}
- {Interaction}: {trigger} → {result}; **no {ruled-out behaviour}**
```

## Data and integrations

**Write here:** Anything fetched, parsed, or generated: precedence as an ordered list, every limit as a number, the safety rules. A precedence list cannot be misread; "use the best title" can.

**Example from the sample:**

> - Title: `<title>` tag → `og:title` → `twitter:title` → first `<h1>` → `og:site_name`
> - Description: `og:description` → `twitter:description` → `meta[name=description]`

**Skeleton:**

```md
{Integration} runs **server-side** after {trigger}. Cap it at {N} seconds; failure {what the user sees} and never blocks {core action}.

Extract {data} with this precedence:

- {Field}: `{source 1}` → `{source 2}` → `{source 3}`
- {Field}: `{source 1}` → `{source 2}`

Safety: {allowed protocols} only, reject {non-public addresses}, at most {N} redirects, at most {N} MiB, only {content types}.

{Identifier}: {allowed characters and case rule}, {min}–{max} characters, unique among {active items}. If blank, generate a random {N}-character {Identifier}.
```

## Identity and ownership

**Write here:** How sign-in works, whether any real provider is called, what ownership is keyed on, how the session is carried, what non-owners get. A status code is a number; "an error" is a guess.

**Example from the sample:**

> An owner can load, edit, and delete their list. Non-owner requests for an owner's list fail (401 on update/delete). My Lists requires login.

**Skeleton:**

```md
Show a login modal: heading "{exact heading}", then {N} full-width buttons in this order, each with its provider's icon:

1. **"{exact button label}"**
2. **"{exact button label}"**

This app {does or does not} call a real identity provider. {How sign-in works locally}. Ownership is the ({stable user ID}, {provider}) pair, not the display name.

Use a server-verifiable HTTP-only session cookie with {SameSite policy}. Signed-in state derives from the server session, never from client storage.

An owner can {load, edit, and delete} their {item}. Non-owner requests fail ({status code} on {operations}). {Owner-only page} requires login.
```

## Theme, responsive UI, and accessibility

**Write here:** The theme control and where its choice is stored, the narrowest working width as a number, the accessibility standard by name and level, and truthful states. "Responsive" is an adjective; these are checks.

**Example from the sample:**

> Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling; the editor, modals, and public page must remain usable.

**Skeleton:**

```md
Theme control: {where it lives}, items **{Theme 1}**, **{Theme 2}**, **{Theme 3}**. Persist the choice in `{storage key}` (default `"{default theme}"`) and apply it via `{attribute}` on `<html>` before first paint.

Support {browser} from desktop down to {N} CSS pixels with no page-level horizontal scrolling.

Meet {accessibility standard and level}, including full keyboard operation and reduced-motion support.

Show truthful loading, empty, success, blocked, and error states. Never present failure as success.
```

## Storage and security

**Write here:** Migrations, transactions, what survives a restart, how untrusted text is rendered, and the test-only reset with method, path, and status code. Name what must never be committed.

**Example from the sample:**

> Use versioned SQL migrations or an idempotent versioned initializer. Enable SQLite foreign keys. Use transactions for publish, save, delete, and reset.

**Skeleton:**

```md
Use {migration strategy}. Enable {database integrity setting}. Use transactions for {the write operations}.

Persist {entities}. Published data must survive a complete restart. Configure the database path by environment variable; do not commit database files.

Treat user text and fetched data as untrusted when rendering, apply CSRF protection, and keep internals out of errors.

Provide a test-only reset, `POST /{reset-path}` returning `{status}`, that {what it clears and restores}. Disable it in production.
```

## Scripts, tests, and documentation

**Write here:** The npm scripts by name, a named list of what unit and browser tests cover, and what the README explains. A named list turns "well tested" into files you can count.

**Example from the sample:**

> Use Vitest for URL and alias validation, random alias generation, metadata parse precedence (title/description/image including the favicon fallback), ownership, SQLite transactions, and share URL construction.

**Skeleton:**

```md
Provide npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `{db scripts}`.

Use {unit test runner} for: {validation rules}, {generation logic}, {parse precedence}, {ownership}, and {transactions}.

Use {browser test runner} for: {each user journey, with the exact strings it must see}; and desktop plus {N}px layouts of {the key screens}.

Tests use a separate temporary database and must not depend on order.

Ship a README covering setup, environment variables, commands, {local sign-in}, reset, tests, and assumptions.
```

## Completion

**Write here:** Numbered steps the agent can run — commands, journeys, a restart — not qualities the result should have, ending with: claim nothing that did not run. This lets the agent stop on its own.

**Example from the sample:**

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
> 2. Start the production build and confirm the app responds.

**Skeleton:**

```md
Before you finish:

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
2. Start the production build and confirm the app responds.
3. In a real {browser}, complete every user journey: {list them by name, including failure paths}.
4. Confirm active data survives a complete restart.
5. Reconcile `TECHNICAL_SPEC.md` against this document; confirm each checked item has evidence.
6. Leave no unchecked item without a reported external blocker.

Report what you built, assumptions, exact command results, and anything incomplete with its reason. Do not claim a check passed unless you ran it.
```

## Before you hand it over

Read it once the way the agent will — front to back, no questions.

- [ ] The first paragraph states the mission and the stop condition.
- [ ] Every screen has a mock or an exact layout rule.
- [ ] The stack is pinned by name, including the alternatives ruled out.
- [ ] Every user-visible string — labels, errors, headings, placeholders — is written out exactly.
- [ ] Every route is listed, with what happens for everything else.
- [ ] Every limit is a number: timeouts, sizes, lengths, redirect counts, breakpoints.
- [ ] The invariants are rules the code must never break, including what must not exist.
- [ ] The unit tests and the browser tests each have a named list of what they cover.
- [ ] The completion checks are commands and journeys the agent can run.
- [ ] Nothing says TBD, and every `{…}` placeholder is gone.

## Hand it to an agent

The hand-over itself is four steps.

1. **Put the PRD in an empty repository.** The sample's first line assumes one: "Build the complete application in this repository." Empty, so the document is the agent's only source of truth.
2. **Start an agent there that can edit files and run commands, and give it the PRD as its instruction** — the whole file, not a summary; point it at the file or paste it.
3. **Let it run to the end.** The PRD says to stop only when the app is complete. If it stops with a question, the answer belongs in the PRD, not in the chat: fix the document and start again ([habit 1](/guide#1-start-with-the-mission-and-the-stop-condition)).
4. **Run the Completion checks yourself.** The PRD's last section is the agent's exit list, and yours. Run the same commands, walk the same journeys, and read the report against the checklist above.

The worked example of all four is [the sample](/sample), ending in [its Completion section](/sample#completion).
