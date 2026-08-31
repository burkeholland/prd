---
title: "PRD template"
description: "The skeleton of a PRD an agent can build from — copy it, keep the order, fill every section."
order: 4
---

Burke Holland's [*Build The Urlist*](/sample) was written to be handed to a coding agent once — no follow-up questions, no review meeting — and it worked: the agent built the app in one shot, or close to it. What made that possible is specificity. Every exact string, number, and exclusion in the document is a decision the model does not have to guess at, and guesses are where one-shot builds fail. This template is that document's skeleton: the same sections in the same order, each with a rule, a line from the sample, and a copyable skeleton.

To use it: keep the section order; delete nothing without deciding it does not apply; replace every `{…}` placeholder, starting with `{Product Name}` in the title; and never leave a section saying "TBD". [Download the clean template](/prd-template.md) to fill in, or copy the skeletons below one at a time.

## Section by section

## Mission and stop condition

**Write here:** One paragraph before anything else: what to build, where, and the condition that ends the work. Without a stop condition the model decides for itself whether a plan, a prototype, or a finished app counts as done. In the sample this paragraph sits directly under the title with no heading of its own.

**Example from the sample:**

> Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.

**Skeleton:**

```md
Build the complete {Product Name} application in this repository. Work autonomously from start to finish and stop only when the app is complete.
```

## Mocks

**Write here:** One named h4 per screen and per visible state — validation, empty, signed in and signed out — each with a screenshot. A mock settles layout, spacing, and hierarchy in one image; a paragraph leaves all three to be guessed.

**Example from the sample:**

> #### New List: Validation States

**Skeleton:**

```md
#### {Screen name}

<img alt="{Screen name}" src="{screenshot URL or path}" />

#### {Screen name}: {State}

<img alt="{Screen name}: {State}" src="{screenshot URL or path}" />
```

## Technical specification and checklist

**Write here:** Tell the agent to write its own spec and checklist before coding, and give the checkbox format exactly. Every requirement then carries a verification method, so "done" is something the agent proves rather than declares.

**Example from the sample:**

> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it.

**Skeleton:**

```md
Before coding, create and commit `TECHNICAL_SPEC.md`. Keep it concise; do not restate this document.

It must contain:

- Architecture, data model, routes/API, security boundaries, and key assumptions
- An atomic Markdown checkbox for every requirement in this document, grouped by feature
- A verification method on every checkbox: unit test, browser test, command, or direct inspection

Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it. Before finishing, resolve every unchecked item or leave it unchecked and report the exact blocker.
```

## Stack and design

**Write here:** Pin every layer by name and name what you are ruling out ("no ORM", "not Edge", "no second CSS framework"). Each unpinned layer is a decision the model makes silently, and it will not necessarily make the same one twice.

**Example from the sample:**

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM
> - Vitest and Playwright
> - Current stable package versions and a committed `package-lock.json`

**Skeleton:**

```md
Use:

- {Framework}, {language and strictness}, {runtime}, and {package manager}
- {Database} with {access method}; no {ruled-out alternative}
- {Unit test runner} and {browser test runner}
- Current stable package versions and a committed `{lockfile}`

Use the {runtime} runtime, not {ruled-out runtime}, for {the features that need it}.

Design system: use {CSS framework} for every screen ({layout, navbar, cards, buttons, modals, forms}) and {icon set} for all icons. Do not add a custom design system or a second CSS framework.
```

## Product

**Write here:** What it is, who can do what, the invariants as plain rules, and a list of what does *not* exist. Exact strings go in bold. The exclusions matter most: a model that is not told "no soft delete" will often build one, and "The server is authoritative" closes a whole class of shortcuts.

**Example from the sample:**

> Deletion is **permanent**: the list's alias becomes immediately available to anyone. There is no soft delete, restore, tombstone, or anonymous list in this product.

**Skeleton:**

```md
{Product Name} lets {who} {do what} and {publish or share it how}.

{Action} requires {condition}; there is no {unrestricted variant}. The {button} button reads **"{exact label while blocked}"** and is disabled while {condition is unmet}. {Ownership rule}. {Destructive action} is **permanent**: {what becomes true immediately}. There is no {thing that does not exist} in this product.

Anyone can {public capability}.

The server is authoritative: revalidate {input, ownership, and uniqueness} on every write; ignore client-supplied {owner IDs}.
```

## Routes

**Write here:** A table of every route and its behavior, the reserved first segments, and the 404 text in bold. A table leaves no route implied, and the catch-all row needs its shape stated so the model does not have to guess how many segments it swallows.

**Example from the sample:**

> | `/{vanity}` | Public list — **a single path segment only** |
> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**
> Static routes take priority over `/{vanity}`. Reserved first segments: `s`, `api`, `__test`.

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

**Write here:** Items in order with exact labels, the condition that shows or hides each, what sits on the right in each signed-in state, and the guard that protects unsaved work with its exact modal strings. Order and wording are otherwise guesses, and a guard the model was not told about is one it will not build.

**Example from the sample:**

> 1. `New` — a "create/add" icon
> 2. `My Lists` — a "user/account" icon — **only when signed in**
> 3. `About` — external link `https://aka.ms/theurlist`, a "help/question" icon
> 4. `Terms` — link to `/s/terms`, an "info" icon

**Skeleton:**

```md
A navbar. Left: {brand or logo} (alt "{alt text}"); on mobile, a menu toggle that expands the menu. Menu items in this order, each an icon plus label:

1. `{Item}` — {icon}
2. `{Item}` — {icon} — **only when {condition}**
3. `{Item}` — link to `{URL or route}`, {icon}

Right: {controls on the right, in order}. Signed out: {login control}. Signed in: {user identity and menu}.

Clicking `{Item}` while {state that would lose work} must pop a confirm modal: title **"{exact title}"**, prompt **"{exact prompt}"** with OK/Cancel. On OK, {result}. Otherwise, {result}.

Document title: "{exact document title}".
```

## Screens

**Write here:** One h3 per screen. Regions top to bottom, every user-visible string in bold and exact, each control with its placeholder, validation rule, and error text, and every loading and empty state. Numbers over adjectives — "64px image", not "a small thumbnail" — because an adjective is a decision handed back to the model.

**Example from the sample:**

> 1. H1 (large, **medium weight — not bold**): **Group links, Save & Share them with the world** — the single words "Group", "Save", and "Share" rendered in the primary teal color at the same weight as the rest of the sentence.

**Skeleton:**

```md
### {Screen name}

{Layout in one paragraph: regions top to bottom, columns on desktop, what stacks or hides on mobile.}

- {Element}: {exact text, size, weight, color, alignment}
- {Control}: placeholder `{exact placeholder}`; validation: {rule}; on invalid show **"{exact error}"**; on valid {result}
- {State}: {loading, empty, or error state and its exact text}

### {Screen name}

{Layout in one paragraph.}

- {Element}: {exact text and appearance}
- {Interaction}: {trigger} → {result}; **no {ruled-out behaviour}**
```

## Data and integrations

**Write here:** Anything fetched, parsed, or generated: precedence as an ordered list, every limit as a number (seconds, redirects, MiB, character ranges), and the safety rules. A precedence list is a decision the model cannot get wrong; "use the best title available" is one it can.

**Example from the sample:**

> - Title: `<title>` tag → `og:title` → `twitter:title` → first `<h1>` → `og:site_name`
> - Description: `og:description` → `twitter:description` → `meta[name=description]`

**Skeleton:**

```md
{Integration} runs **server-side** after {trigger}. Cap it at {N} seconds. Failure {what the user sees}; {core action} is never blocked by it.

Extract {data} with this precedence:

- {Field}: `{source 1}` → `{source 2}` → `{source 3}`
- {Field}: `{source 1}` → `{source 2}`

The fetcher must be safe: {allowed protocols} only, reject {non-public addresses}, follow at most {N} redirects, limit content to {N} MiB, accept only {content types}. Empty {data} is a successful result.

{Identifier} is {allowed characters and case rule}, {min}–{max} characters. It is globally unique among {active items}. If blank, generate an available {N}-character random {Identifier} from {alphabet}.
```

## Identity and ownership

**Write here:** How sign-in works, whether any real provider is called (say so plainly if not), what ownership is keyed on, how the session is carried, and exactly what non-owners get. A status code is a number; "an error" is a guess.

**Example from the sample:**

> An owner can load, edit, and delete their list. Non-owner requests for an owner's list fail (401 on update/delete). My Lists requires login.

**Skeleton:**

```md
Show a login modal: a heading "{exact heading}" with the logo, then {N} full-width buttons, in this order, each with its provider's icon:

1. **"{exact button label}"**
2. **"{exact button label}"**

This app {does or does not} call a real identity provider. {How sign-in works locally: mock identities, how many, where stored}. Ownership is the ({stable user ID}, {provider}) pair, not the display name.

Use a server-verifiable HTTP-only session cookie with {SameSite policy}; {Secure rule for production and local HTTP}. Login survives reload; logout ends the session. Signed-in state derives from the server session, never from client storage.

An owner can {load, edit, and delete} their {item}. Non-owner requests fail ({status code} on {operations}). {Owner-only page} requires login.
```

## Theme, responsive UI, and accessibility

**Write here:** The theme control and where its choice is stored, the narrowest width that must work as a number, the accessibility standard by name and level, and the rule that every state is shown truthfully. "Responsive" and "accessible" on their own are adjectives; these are checks the agent can run.

**Example from the sample:**

> Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling; the editor, modals, and public page must remain usable.

**Skeleton:**

```md
Theme control: {where it lives}, with items **{Theme 1}**, **{Theme 2}**, **{Theme 3}**. Persist the choice in `{storage key}` (default `"{default theme}"`), apply it via `{attribute}` on `<html>`, and set it before first paint to avoid a wrong-theme flash.

Support {browser} from desktop down to {N} CSS pixels with no page-level horizontal scrolling; {the screens that must remain usable}.

Meet {accessibility standard and level}, including full keyboard operation, reduced-motion support, sensible focus management, and announced status/error changes.

Show truthful loading, empty, success, blocked, and error states. Errors must explain recovery. Never present failure as success.
```

## Storage and security

**Write here:** Migrations, transactions, what must survive a restart, how untrusted text is rendered, and the test-only reset with its method, path, and status code. Name what must never be committed. Each of these is a default the model would otherwise pick for you.

**Example from the sample:**

> Use versioned SQL migrations or an idempotent versioned initializer. Enable SQLite foreign keys. Use transactions for publish, save, delete, and reset.

**Skeleton:**

```md
Use {migration strategy}. Enable {database integrity setting}. Use transactions for {the write operations}.

Persist {entities}. Published data must survive a complete restart. Configure the database path by environment variable with a safe local default; do not commit database files.

Treat user text and fetched data as untrusted when rendering, prevent stored/reflected script execution, apply CSRF protection, and keep internals out of errors.

Provide a development/test-only deterministic reset, preferably `POST /{reset-path}` returning `{status}`. It {what it clears and restores}. Disable or protect it in production.
```

## Scripts, tests, and documentation

**Write here:** The npm scripts by name, a named list of what unit tests and browser tests must cover, and what the README must explain. A named test list turns "well tested" into a set of files the model can write and you can count.

**Example from the sample:**

> Use Vitest for URL and alias validation, random alias generation, metadata parse precedence (title/description/image including the favicon fallback), ownership, SQLite transactions, and share URL construction.

**Skeleton:**

```md
Provide npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `{db scripts}`.

Use {unit test runner} for: {validation rules}, {generation logic}, {parse precedence}, {ownership}, {transactions}, and {URL construction}.

Use {browser test runner} for: {each user journey, one clause per journey, with the exact strings it must see}; {each error state}; and desktop plus {N}px mobile layouts of {the key screens}.

Tests use a separate temporary database and must not depend on order.

Ship a README covering setup, environment variables, database, commands, {local sign-in}, reset, tests, and assumptions.
```

## Completion

**Write here:** Numbered steps the agent can run — commands, journeys, a restart — not qualities the result should have, ending with the rule that nothing is claimed unless it ran. This is what lets the model stop on its own instead of asking whether it is done.

**Example from the sample:**

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
> 2. Start the production build and confirm the app responds.

**Skeleton:**

```md
Before you finish:

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
2. Start the production build and confirm the app responds.
3. In a real {browser}, complete every user journey: {list every journey by name, including the failure paths}.
4. Confirm active data survives a complete restart.
5. Reconcile `TECHNICAL_SPEC.md` against this document, fix every missing or incorrect requirement, and confirm each checked item has evidence.
6. Repeat affected validation and leave no unchecked item unless it has a reported external blocker.

Report what you built, assumptions, architecture, exact command results, and anything incomplete with its reason. Do not claim a check passed unless you ran it successfully.
```

## Before you hand it over

Read the finished document once the way the agent will: front to back, no questions allowed.

- [ ] The first paragraph states the mission and the stop condition.
- [ ] Every screen the user will see has a mock or an exact layout rule.
- [ ] The stack is pinned by name, including the alternatives ruled out.
- [ ] Every user-visible string — labels, errors, headings, placeholders — is written out exactly.
- [ ] Every route is listed, with what it shows and what happens for everything else.
- [ ] Every limit is a number: timeouts, sizes, lengths, redirect counts, breakpoints.
- [ ] The invariants are stated as rules the code must never break, including what must not exist.
- [ ] The unit tests and the browser tests each have a named list of what they must cover.
- [ ] The completion checks are commands and journeys the agent can run, not qualities the result should have.
- [ ] Nothing is marked TBD, to be decided, or later, and every `{…}` placeholder is gone.

Ten ticks and the document is ready to hand over.
