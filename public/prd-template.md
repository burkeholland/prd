# Build {Product Name}

## Mission and stop condition
<!-- One paragraph: what to build, where it lives, and the condition that ends the work. In the sample it stands directly under the title with no heading of its own; keep this heading or drop it, but keep the paragraph first. -->
Build the complete {Product Name} application in this repository. Work autonomously from start to finish and stop only when the app is complete.

## Mocks
<!-- One h4 per screen and per visible state, each followed by its screenshot. Name validation, empty, and signed-in/out states too — a mock the agent can see beats a paragraph it has to imagine. -->
#### {Screen name}

<img alt="{Screen name}" src="{screenshot URL or path}" />

#### {Screen name}: {State}

<img alt="{Screen name}: {State}" src="{screenshot URL or path}" />

## Technical specification and checklist
<!-- Make the agent write its own spec and checklist before coding, and give the exact checkbox format so every requirement carries a verification method. -->
Before coding, create and commit `TECHNICAL_SPEC.md`: architecture, data model, routes/API, security boundaries, key assumptions, and an atomic Markdown checkbox for every requirement in this document, grouped by feature, each with a verification method.

Use the format `- [ ] Requirement — Verify: method`. Check an item only after its verification passes; reopen it if later work breaks it. Before finishing, resolve every unchecked item or report the exact blocker.

## Stack and design
<!-- Pin every layer by name, name the alternatives you are ruling out, and fix the design system so no screen gets a second one. -->
Use:

- {Framework}, {language and strictness}, {runtime}, and {package manager}
- {Database} with {access method}; no {ruled-out alternative}
- {Unit test runner} and {browser test runner}
- Current stable package versions and a committed `{lockfile}`

Design system: {CSS framework} for every screen, {icon set} for all icons; no second CSS framework.

## Product
<!-- What it is, who can do what, the invariants the code must never break, and what does not exist in this product. -->
{Product Name} lets {who} {do what} and {publish or share it how}.

{Action} requires {condition}. The {button} button reads **"{exact label while blocked}"** and is disabled until then. {Ownership rule}. {Destructive action} is **permanent**: {what becomes true immediately}. There is no {thing that does not exist} in this product.

Anyone can {public capability}.

The server is authoritative: revalidate {input, ownership, and uniqueness} on every write; ignore client-supplied {owner IDs}.

## Routes
<!-- A table of every route, the reserved first segments, and the exact text of the 404 page. -->
| Route | Behavior |
|---|---|
| `/` | {Home page} |
| `/{segment}/{page}` | {What it shows, and who may see it} |
| `/{vanity}` | Public {item} — **a single path segment only** |

404 page (everything else, including multi-segment paths): show the text **"{exact 404 message}"**.

Static routes take priority over `/{vanity}`. Reserved first segments: `{segment}`, `api`, `__test`.

## Navigation
<!-- The navbar item by item, in order, with exact labels, the condition that shows or hides each, and any guard that protects unsaved work. -->
A navbar. Left: {brand or logo} (alt "{alt text}"). Menu items in this order, each an icon plus label:

1. `{Item}` — {icon}
2. `{Item}` — {icon} — **only when {condition}**
3. `{Item}` — link to `{URL or route}`, {icon}

Right: {controls, in order}; signed out: {login control}; signed in: {user identity and menu}.

Clicking `{Item}` while {state that would lose work} pops a confirm modal: title **"{exact title}"**, prompt **"{exact prompt}"**, OK/Cancel.

Document title: "{exact document title}".

## Screens
<!-- One h3 per screen: regions top to bottom, every string in bold and exact, every control with its validation rule and error text, every loading and empty state. -->
### {Screen name}

{Layout: regions top to bottom, desktop columns, what stacks or hides on mobile.}

- {Element}: {exact text, size, weight, color, alignment}
- {Control}: placeholder `{exact placeholder}`; validation: {rule}; on invalid show **"{exact error}"**; on valid {result}
- {State}: {loading, empty, or error state and its exact text}

### {Screen name}

{Layout in one paragraph.}

- {Element}: {exact text and appearance}
- {Interaction}: {trigger} → {result}; **no {ruled-out behaviour}**

## Data and integrations
<!-- Anything fetched, parsed, or generated: precedence as an ordered list, every limit as a number, and the safety rules. -->
{Integration} runs **server-side** after {trigger}. Cap it at {N} seconds; failure {what the user sees} and never blocks {core action}.

Extract {data} with this precedence:

- {Field}: `{source 1}` → `{source 2}` → `{source 3}`
- {Field}: `{source 1}` → `{source 2}`

Safety: {allowed protocols} only, reject {non-public addresses}, at most {N} redirects, at most {N} MiB, only {content types}.

{Identifier}: {allowed characters and case rule}, {min}–{max} characters, unique among {active items}. If blank, generate a random {N}-character {Identifier}.

## Identity and ownership
<!-- How sign-in works, whether any real provider is called, what ownership is keyed on, and what non-owners get. -->
Show a login modal: heading "{exact heading}", then {N} full-width buttons in this order, each with its provider's icon:

1. **"{exact button label}"**
2. **"{exact button label}"**

This app {does or does not} call a real identity provider. {How sign-in works locally}. Ownership is the ({stable user ID}, {provider}) pair, not the display name.

Use a server-verifiable HTTP-only session cookie with {SameSite policy}. Signed-in state derives from the server session, never from client storage.

An owner can {load, edit, and delete} their {item}. Non-owner requests fail ({status code} on {operations}). {Owner-only page} requires login.

## Theme, responsive UI, and accessibility
<!-- The theme control and its persistence, the narrowest width that must work, the accessibility standard, and the rule that every state is shown truthfully. -->
Theme control: {where it lives}, items **{Theme 1}**, **{Theme 2}**, **{Theme 3}**. Persist the choice in `{storage key}` (default `"{default theme}"`) and apply it via `{attribute}` on `<html>` before first paint.

Support {browser} from desktop down to {N} CSS pixels with no page-level horizontal scrolling.

Meet {accessibility standard and level}, including full keyboard operation and reduced-motion support.

Show truthful loading, empty, success, blocked, and error states. Never present failure as success.

## Storage and security
<!-- Migrations, transactions, what must survive a restart, how untrusted text is handled, and the test-only reset. -->
Use {migration strategy}. Enable {database integrity setting}. Use transactions for {the write operations}.

Persist {entities}. Published data must survive a complete restart. Configure the database path by environment variable; do not commit database files.

Treat user text and fetched data as untrusted when rendering, apply CSRF protection, and keep internals out of errors.

Provide a test-only reset, `POST /{reset-path}` returning `{status}`, that {what it clears and restores}. Disable it in production.

## Scripts, tests, and documentation
<!-- The npm scripts by name, a named list of what unit tests and browser tests must cover, and what the README must explain. -->
Provide npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `{db scripts}`.

Use {unit test runner} for: {validation rules}, {generation logic}, {parse precedence}, {ownership}, and {transactions}.

Use {browser test runner} for: {each user journey, with the exact strings it must see}; and desktop plus {N}px layouts of {the key screens}.

Tests use a separate temporary database and must not depend on order.

Ship a README covering setup, environment variables, commands, {local sign-in}, reset, tests, and assumptions.

## Completion
<!-- Numbered checks the agent can run, not qualities the result should have, and the rule that nothing is claimed unless it ran. -->
Before you finish:

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
2. Start the production build and confirm the app responds.
3. In a real {browser}, complete every user journey: {list them by name, including failure paths}.
4. Confirm active data survives a complete restart.
5. Reconcile `TECHNICAL_SPEC.md` against this document; confirm each checked item has evidence.
6. Leave no unchecked item without a reported external blocker.

Report what you built, assumptions, exact command results, and anything incomplete with its reason. Do not claim a check passed unless you ran it.
