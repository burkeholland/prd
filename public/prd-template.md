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
Before coding, create and commit `TECHNICAL_SPEC.md`. Keep it concise; do not restate this document.

It must contain:

- Architecture, data model, routes/API, security boundaries, and key assumptions
- An atomic Markdown checkbox for every requirement in this document, grouped by feature
- A verification method on every checkbox: unit test, browser test, command, or direct inspection

Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it. Before finishing, resolve every unchecked item or leave it unchecked and report the exact blocker.

## Stack and design
<!-- Pin every layer by name, name the alternatives you are ruling out, and fix the design system so no screen gets a second one. -->
Use:

- {Framework}, {language and strictness}, {runtime}, and {package manager}
- {Database} with {access method}; no {ruled-out alternative}
- {Unit test runner} and {browser test runner}
- Current stable package versions and a committed `{lockfile}`

Use the {runtime} runtime, not {ruled-out runtime}, for {the features that need it}.

Design system: use {CSS framework} for every screen ({layout, navbar, cards, buttons, modals, forms}) and {icon set} for all icons. Do not add a custom design system or a second CSS framework.

## Product
<!-- What it is, who can do what, the invariants the code must never break, and what does not exist in this product. -->
{Product Name} lets {who} {do what} and {publish or share it how}.

{Action} requires {condition}; there is no {unrestricted variant}. The {button} button reads **"{exact label while blocked}"** and is disabled while {condition is unmet}. {Ownership rule}. {Destructive action} is **permanent**: {what becomes true immediately}. There is no {thing that does not exist} in this product.

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
A navbar. Left: {brand or logo} (alt "{alt text}"); on mobile, a menu toggle that expands the menu. Menu items in this order, each an icon plus label:

1. `{Item}` — {icon}
2. `{Item}` — {icon} — **only when {condition}**
3. `{Item}` — link to `{URL or route}`, {icon}

Right: {controls on the right, in order}. Signed out: {login control}. Signed in: {user identity and menu}.

Clicking `{Item}` while {state that would lose work} must pop a confirm modal: title **"{exact title}"**, prompt **"{exact prompt}"** with OK/Cancel. On OK, {result}. Otherwise, {result}.

Document title: "{exact document title}".

## Screens
<!-- One h3 per screen: regions top to bottom, every string in bold and exact, every control with its validation rule and error text, every loading and empty state. -->
### {Screen name}

{Layout in one paragraph: regions top to bottom, columns on desktop, what stacks or hides on mobile.}

- {Element}: {exact text, size, weight, color, alignment}
- {Control}: placeholder `{exact placeholder}`; validation: {rule}; on invalid show **"{exact error}"**; on valid {result}
- {State}: {loading, empty, or error state and its exact text}

### {Screen name}

{Layout in one paragraph.}

- {Element}: {exact text and appearance}
- {Interaction}: {trigger} → {result}; **no {ruled-out behaviour}**

## Data and integrations
<!-- Anything fetched, parsed, or generated: precedence as an ordered list, every limit as a number, and the safety rules. -->
{Integration} runs **server-side** after {trigger}. Cap it at {N} seconds. Failure {what the user sees}; {core action} is never blocked by it.

Extract {data} with this precedence:

- {Field}: `{source 1}` → `{source 2}` → `{source 3}`
- {Field}: `{source 1}` → `{source 2}`

The fetcher must be safe: {allowed protocols} only, reject {non-public addresses}, follow at most {N} redirects, limit content to {N} MiB, accept only {content types}. Empty {data} is a successful result.

{Identifier} is {allowed characters and case rule}, {min}–{max} characters. It is globally unique among {active items}. If blank, generate an available {N}-character random {Identifier} from {alphabet}.

## Identity and ownership
<!-- How sign-in works, whether any real provider is called, what ownership is keyed on, and what non-owners get. -->
Show a login modal: a heading "{exact heading}" with the logo, then {N} full-width buttons, in this order, each with its provider's icon:

1. **"{exact button label}"**
2. **"{exact button label}"**

This app {does or does not} call a real identity provider. {How sign-in works locally: mock identities, how many, where stored}. Ownership is the ({stable user ID}, {provider}) pair, not the display name.

Use a server-verifiable HTTP-only session cookie with {SameSite policy}; {Secure rule for production and local HTTP}. Login survives reload; logout ends the session. Signed-in state derives from the server session, never from client storage.

An owner can {load, edit, and delete} their {item}. Non-owner requests fail ({status code} on {operations}). {Owner-only page} requires login.

## Theme, responsive UI, and accessibility
<!-- The theme control and its persistence, the narrowest width that must work, the accessibility standard, and the rule that every state is shown truthfully. -->
Theme control: {where it lives}, with items **{Theme 1}**, **{Theme 2}**, **{Theme 3}**. Persist the choice in `{storage key}` (default `"{default theme}"`), apply it via `{attribute}` on `<html>`, and set it before first paint to avoid a wrong-theme flash.

Support {browser} from desktop down to {N} CSS pixels with no page-level horizontal scrolling; {the screens that must remain usable}.

Meet {accessibility standard and level}, including full keyboard operation, reduced-motion support, sensible focus management, and announced status/error changes.

Show truthful loading, empty, success, blocked, and error states. Errors must explain recovery. Never present failure as success.

## Storage and security
<!-- Migrations, transactions, what must survive a restart, how untrusted text is handled, and the test-only reset. -->
Use {migration strategy}. Enable {database integrity setting}. Use transactions for {the write operations}.

Persist {entities}. Published data must survive a complete restart. Configure the database path by environment variable with a safe local default; do not commit database files.

Treat user text and fetched data as untrusted when rendering, prevent stored/reflected script execution, apply CSRF protection, and keep internals out of errors.

Provide a development/test-only deterministic reset, preferably `POST /{reset-path}` returning `{status}`. It {what it clears and restores}. Disable or protect it in production.

## Scripts, tests, and documentation
<!-- The npm scripts by name, a named list of what unit tests and browser tests must cover, and what the README must explain. -->
Provide npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `{db scripts}`.

Use {unit test runner} for: {validation rules}, {generation logic}, {parse precedence}, {ownership}, {transactions}, and {URL construction}.

Use {browser test runner} for: {each user journey, one clause per journey, with the exact strings it must see}; {each error state}; and desktop plus {N}px mobile layouts of {the key screens}.

Tests use a separate temporary database and must not depend on order.

Ship a README covering setup, environment variables, database, commands, {local sign-in}, reset, tests, and assumptions.

## Completion
<!-- Numbered checks the agent can run, not qualities the result should have, and the rule that nothing is claimed unless it ran. -->
Before you finish:

1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
2. Start the production build and confirm the app responds.
3. In a real {browser}, complete every user journey: {list every journey by name, including the failure paths}.
4. Confirm active data survives a complete restart.
5. Reconcile `TECHNICAL_SPEC.md` against this document, fix every missing or incorrect requirement, and confirm each checked item has evidence.
6. Repeat affected validation and leave no unchecked item unless it has a reported external blocker.

Report what you built, assumptions, architecture, exact command results, and anything incomplete with its reason. Do not claim a check passed unless you ran it successfully.
