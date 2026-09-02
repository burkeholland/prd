---
title: "PRD template"
description: "An annotated PRD starting point you can adapt to fit the product and its constraints."
order: 4
---

This annotated template is a starting point for writing decisions an agent can act on. Each section includes a prompt, a real excerpt from the [Example PRD](/sample), and Markdown to copy.

Change, remove, reorder, or skip sections that do not apply. Replace the `{...}` placeholders you keep with product decisions. [Download the clean Markdown template](/prd-template.md) or copy individual blocks below.

## Mission and stop condition

**Write:** State what to build, where to build it, and the condition for stopping. This fixes the scope and definition of done.

**Example:**

> Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.

**Template:**

```md
Build the complete {Product Name} application in this repository. Work autonomously from start to finish and stop only when the app is complete.
```

## Mocks

**Write:** Add a named screenshot for every screen and visible state, including validation, empty, signed-in, and signed-out states. This fixes the intended layout and state design.

**Example:**

<!-- Shown as markdown source in a code span, not as a live h4, so the page's outline does not skip h2 → h4 (axe heading-order). -->

> `#### New List: Validation States`

**Template:**

```md
#### {Screen name}

<img alt="{Screen name}" src="{screenshot URL or path}" />

#### {Screen name}: {State}

<img alt="{Screen name}: {State}" src="{screenshot URL or path}" />
```

## Technical specification and checklist

**Write:** Require a technical specification and atomic checklist before implementation, including the exact checkbox format and verification method. This fixes how each requirement will be proved complete.

**Example:**

> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it.

**Template:**

```md
Before coding, create and commit `TECHNICAL_SPEC.md`: architecture, data model, routes/API, security boundaries, key assumptions, and an atomic Markdown checkbox for every requirement in this document, grouped by feature, each with a verification method.

Use the format `- [ ] Requirement — Verify: method`. Check an item only after its verification passes; reopen it if later work breaks it. Before finishing, resolve every unchecked item or report the exact blocker.
```

## Stack and design

**Write:** Name every technology, tool, version policy, and ruled-out alternative. This fixes implementation choices before work begins.

**Example:**

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM

**Template:**

```md
Use:

- {Framework}, {language and strictness}, {runtime}, and {package manager}
- {Database} with {access method}; no {ruled-out alternative}
- {Unit test runner} and {browser test runner}
- Current stable package versions and a committed `{lockfile}`

Design system: {CSS framework} for every screen, {icon set} for all icons; no second CSS framework.
```

## Product

**Write:** Define users, capabilities, invariants, exact strings, destructive behavior, and excluded features. This fixes the product boundaries.

**Example:**

> Deletion is **permanent**: the list's alias becomes immediately available to anyone. There is no soft delete, restore, tombstone, or anonymous list in this product.

**Template:**

```md
{Product Name} lets {who} {do what} and {publish or share it how}.

{Action} requires {condition}. The {button} button reads **"{exact label while blocked}"** and is disabled until then. {Ownership rule}. {Destructive action} is **permanent**: {what becomes true immediately}. There is no {thing that does not exist} in this product.

Anyone can {public capability}.

The server is authoritative: revalidate {input, ownership, and uniqueness} on every write; ignore client-supplied {owner IDs}.
```

## Routes

**Write:** List every route, reserved segment, catch-all behavior, and exact 404 message. This fixes URL precedence and unmatched-path behavior.

**Example:**

> | `/{vanity}` | Public list — **a single path segment only** |
> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**

**Template:**

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

**Write:** List navigation items in order, their visibility rules, signed-in and signed-out controls, and any unsaved-work guard. This fixes the available actions in every state.

**Example:**

> 1. `New` — a "create/add" icon
> 2. `My Lists` — a "user/account" icon — **only when signed in**

**Template:**

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

**Write:** Describe each screen from top to bottom, including exact text, controls, validation, responsive layout, and loading, empty, and error states. This fixes what each state must display and do.

**Example:**

> - Helper text above the input (left-aligned, regular-weight body text — not a small bold form label): **"Enter a link and press enter"**

**Template:**

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

**Write:** Specify each external or generated data flow, precedence rule, numeric limit, and safety constraint. This fixes how data is selected and what inputs are allowed.

**Example:**

> - Title: `<title>` tag → `og:title` → `twitter:title` → first `<h1>` → `og:site_name`
> - Description: `og:description` → `twitter:description` → `meta[name=description]`

**Template:**

```md
{Integration} runs **server-side** after {trigger}. Cap it at {N} seconds; failure {what the user sees} and never blocks {core action}.

Extract {data} with this precedence:

- {Field}: `{source 1}` → `{source 2}` → `{source 3}`
- {Field}: `{source 1}` → `{source 2}`

Safety: {allowed protocols} only, reject {non-public addresses}, at most {N} redirects, at most {N} MiB, only {content types}.

{Identifier}: {allowed characters and case rule}, {min}–{max} characters, unique among {active items}. If blank, generate a random {N}-character {Identifier}.
```

## Identity and ownership

**Write:** Define sign-in behavior, session handling, the ownership key, protected capabilities, and exact failure status codes. This fixes who may act on each resource.

**Example:**

> An owner can load, edit, and delete their list. Non-owner requests for an owner's list fail (401 on update/delete). My Lists requires login.

**Template:**

```md
Show a login modal: heading "{exact heading}", then {N} full-width buttons in this order, each with its provider's icon:

1. **"{exact button label}"**
2. **"{exact button label}"**

This app {does or does not} call a real identity provider. {How sign-in works locally}. Ownership is the ({stable user ID}, {provider}) pair, not the display name.

Use a server-verifiable HTTP-only session cookie with {SameSite policy}. Signed-in state derives from the server session, never from client storage.

An owner can {load, edit, and delete} their {item}. Non-owner requests fail ({status code} on {operations}). {Owner-only page} requires login.
```

## Theme, responsive UI, and accessibility

**Write:** Set theme behavior and persistence, minimum supported width, accessibility target, and truthful UI states. This fixes visual preferences and usability requirements across conditions.

**Example:**

> Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling; the editor, modals, and public page must remain usable.

**Template:**

```md
Theme control: {where it lives}, items **{Theme 1}**, **{Theme 2}**, **{Theme 3}**. Persist the choice in `{storage key}` (default `"{default theme}"`) and apply it via `{attribute}` on `<html>` before first paint.

Support {browser} from desktop down to {N} CSS pixels with no page-level horizontal scrolling.

Meet {accessibility standard and level}, including full keyboard operation and reduced-motion support.

Show truthful loading, empty, success, blocked, and error states. Never present failure as success.
```

## Storage and security

**Write:** Specify migrations, transaction boundaries, persistence, untrusted-data handling, CSRF protection, and the test-only reset. This fixes data durability and security boundaries.

**Example:**

> Use versioned SQL migrations or an idempotent versioned initializer. Enable SQLite foreign keys. Use transactions for publish, save, delete, and reset.

**Template:**

```md
Use {migration strategy}. Enable {database integrity setting}. Use transactions for {the write operations}.

Persist {entities}. Published data must survive a complete restart. Configure the database path by environment variable; do not commit database files.

Treat user text and fetched data as untrusted when rendering, apply CSRF protection, and keep internals out of errors.

Provide a test-only reset, `POST /{reset-path}` returning `{status}`, that {what it clears and restores}. Disable it in production.
```

## Scripts, tests, and documentation

**Write:** Name required scripts, unit and browser test coverage, test isolation, and README content. This fixes how the implementation is operated and verified.

**Example:**

> Use Vitest for URL and alias validation, random alias generation, metadata parse precedence (title/description/image including the favicon fallback), ownership, SQLite transactions, and share URL construction.

**Template:**

```md
Provide npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `{db scripts}`.

Use {unit test runner} for: {validation rules}, {generation logic}, {parse precedence}, {ownership}, and {transactions}.

Use {browser test runner} for: {each user journey, with the exact strings it must see}; and desktop plus {N}px layouts of {the key screens}.

Tests use a separate temporary database and must not depend on order.

Ship a README covering setup, environment variables, commands, {local sign-in}, reset, tests, and assumptions.
```

## Completion

**Write:** List the exact commands, user journeys, restart check, and checklist reconciliation required before handoff. This fixes the evidence required to declare the product complete.

**Example:**

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
> 2. Start the production build and confirm the app responds.

**Template:**

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
