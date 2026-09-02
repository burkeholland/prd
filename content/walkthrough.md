---
title: "Example PRD, section by section"
description: "How each section removes a decision, with an excerpt and a rule you can reuse."
order: 3
---

Read the [Example PRD](/sample) section by section. Each entry pairs a verbatim excerpt with the decision it settles and a reusable rule. Start from the full example, or use the [Template](/template) to draft a new document.

## Mocks

<!-- quote: not-gist -->
> Home Page  
> New List  
> New List: Validation States  
> Login Modal  
> My Lists (Logged In)  
> Published List  
> Published List: QR Code

**What it does** — The [Mocks section](/sample#mocks) opens with seven named reference screens. The headings and screenshots define the target interface and distinguish the provided reference from the implementation.

**Why it works** — Screenshots resolve layout details more efficiently than long descriptions. Naming each state alongside its screen also makes validation and error presentation explicit.

**Use this** — Provide a named screenshot for every required screen and state before writing the specification.

## Technical specification and checklist

> Before coding, create and commit `TECHNICAL_SPEC.md`. …
>
> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it. …

**What it does** — [Before implementation](/sample#technical-specification-and-checklist), it requires a committed technical specification with one checkbox and verification method for each requirement.

**Why it works** — Turning requirements into atomic, verifiable items keeps the full scope visible throughout implementation. `Verify: method` gives every item a concrete completion condition.

**Use this** — Require a checkbox specification with a verification method on every line before implementation begins.

## Stack and design

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM
>
> …
>
> Design system: use Bulma CSS for every screen … and Font Awesome for all icons. Do not add a custom design system or a second CSS framework.

**What it does** — [Names every layer](/sample#stack-and-design): framework, language, database, test runners, CSS framework, icon set, and runtime. It also rules out an ORM, Edge runtime, and second CSS framework.

**Why it works** — Exact libraries remove early architectural ambiguity, while explicit exclusions prevent incompatible alternatives. Naming Bulma also gives later visual requirements a shared vocabulary, including classes such as `button is-fullwidth`.

**Use this** — Name every library and runtime, then list the obvious alternatives that are out of scope.

## Product

> Publishing requires a signed-in user; there is no anonymous publishing. … There is no soft delete, restore, tombstone, or anonymous list in this product.
>
> …
>
> The server is authoritative: revalidate input, ownership, and alias availability on every write; ignore client-supplied owner IDs.

**What it does** — [Defines the product](/sample#product), then sets its operating rules: who can publish, who owns a list, what deletion means, and when the server is authoritative.

**Why it works** — Explicit exclusions bound the product scope. A single server-authority rule applies consistently to every write, while bold text identifies exact interface copy such as **"Login to Publish"**.

**Use this** — State what the product does not include, and name each excluded feature.

## Routes

> | Route | Behavior |
> |---|---|
> | … | … |
> | `/{vanity}` | Public list — **a single path segment only** |
>
> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**
>
> Static routes take priority over `/{vanity}`. Reserved first segments: `s`, `api`, `__test`.

**What it does** — [Lists six routes](/sample#routes) in a table with one line of behavior each, then defines the 404 copy, a priority rule, and three reserved first segments. The [Navigation bar](/sample#navigation-bar) subsection applies the same precision to the menu.

**Why it works** — A route table makes the surface and completion boundary explicit. The priority rule and reserved segments resolve the `/s/new` and `/{vanity}` collision. The navigation requirements also define conditional visibility and exact guard copy.

**Use this** — Put every route in a table with one line of behavior, then define precedence where patterns overlap.

## Home page

> - … Validation: non-empty after trim; must parse as an absolute `http` or `https` URL … Invalid: apply the invalid input state and show **"That doesn't look like a valid URL"**

**Same move** — [The home page](/sample#home-page-1) puts every user-visible string in bold and defines validation as ordered steps: trim, then parse as an absolute URL.

## Draft and editor

> **In-place editing (this is the key interaction):** the title, description, and URL are rendered as plain text — there are no visible input boxes, borders, field backgrounds, labels, or save buttons inside the row. …
>
> Reordering is **drag-and-drop only**, via the grip handle, … No other reorder affordances.

**What it does** — [Defines the draft](/sample#draft-and-editor) and editor page, then specifies the [Publish bar](/sample#publish-bar), including messages and enabled states, and the [Link list editor](/sample#link-list-editor), including row anatomy and in-place editing.

**Why it works** — Describing both the required interaction and the elements that must be absent prevents a standard form from replacing the intended in-place editor. The publish bar makes alias behavior observable through exact error strings and a 300ms availability check.

**Use this** — Identify the key interaction and specify both what appears and what must remain absent.

## Live metadata

> - Title: `<title>` tag → `og:title` → `twitter:title` → first `<h1>` → `og:site_name`
>
> …
>
> The fetcher must be SSRF-safe: HTTP/HTTPS only, no credentials embedded, reject non-public and internal addresses, revalidate DNS on every redirect to prevent rebinding, follow at most five redirects, limit content to 2 MiB, accept only HTML/XHTML, and never forward app credentials. …

**What it does** — [When a link is added](/sample#live-metadata), the server fetches the destination and fills in title, description, and image, with a 20-second limit, field-level precedence, and a security checklist.

**Why it works** — An arrow chain expresses precedence in an implementable, testable form. The SSRF paragraph separates hardening into concrete checks. "Empty metadata is a successful result" defines failure semantics so missing metadata does not block publishing.

**Use this** — Write fallback order as an explicit chain and security requirements as a checklist of individual checks.

## Aliases and publication

> An alias is **one segment** of letters, numbers, and hyphens (normalized to lowercase; 1–50 characters). It is globally unique among **active** lists …
>
> … generate an available 7-character random alias from lowercase letters and digits.

**Same move** — [The alias definition](/sample#aliases-and-publication) replaces adjectives with exact limits: 1–50 characters, 7 when generated, and lowercase letters and digits.

## Login and ownership

> 1. **"with Twitter/X"**
> 2. **"with GitHub"**
> 3. **"with Google"**
>
> … Each button signs in as a stable fictional user stored in SQLite; … Ownership is the (stable user ID, provider) pair, not the display name.

**What it does** — [Defines a login modal](/sample#login-and-ownership) with three provider buttons that use SQLite-backed mock identities and a server-verifiable session cookie instead of external providers.

**Why it works** — Mock identities remove dependence on external credentials while preserving testable sign-in and ownership flows. At least two stable identities support authorization checks. Defining ownership as the (user ID, provider) pair fixes the schema rule, and "401 on update/delete" gives failures a testable status code.

**Use this** — Replace an unavailable dependency with a mock precise enough to support every dependent flow and test.

## My Lists

> - While loading: 3 skeleton tiles. …
>
> There is **no Deleted section and no Restore action**.

**Same move** — [My Lists](/sample#my-lists) uses exact quantities: 1 to 4 columns by breakpoint and 3 skeleton tiles. It then states an invariant: no Deleted section and no Restore action.

## Delete

> Clicking it opens a danger confirm modal with title **"Delete this list?"** and body **"The url {vanity} will be released for others to use."** …
>
> … There is no restore.

**Same move** — [Delete](/sample#delete) puts exact user-visible strings in bold, including the `{vanity}` placeholder, and restates the no-restore invariant beside the deletion behavior.

## Public list

> When the alias does not resolve to an active list, show the not-found state instead: … H2 **"We couldn't find that Urlist"**, and H3 **"But don't be sad! That means {vanity} is still available."** …

**Same move** — [The public list](/sample#public-list) defines each state with exact bold strings, including not found, and uses numbers for the remaining details: 5 skeleton rows, a 4x QR module scale, and `#121212` on `#F9FAFC`.

## Theme, responsive UI, and accessibility

> Meet WCAG 2.2 AA, including full keyboard operation, reduced-motion support, sensible focus management, and announced status/error changes. …
>
> Show truthful loading, empty, success, blocked, and error states. …

**Same move** — [The theme and accessibility rules](/sample#theme-responsive-ui-and-accessibility) set app-wide invariants for WCAG 2.2 AA and truthful states, plus a measurable 320 CSS pixel floor.

## Storage and security

> … Enable SQLite foreign keys. Use transactions for publish, save, delete, and reset.
>
> …
>
> Treat user text and fetched metadata as untrusted when rendering, …

**Same move** — [Storage and security](/sample#storage-and-security) states invariants as rules: enable foreign keys, use transactions for four named operations, and treat fetched metadata and user text as untrusted.

## Scripts, tests, and documentation

> Use Playwright for: the home page first-link flow (valid and invalid → "That doesn't look like a valid URL"); draft persistence across reload and logout; …
>
> Tests use a separate temporary database and must not depend on order.

**What it does** — [Names nine npm scripts](/sample#scripts-tests-and-documentation), the unit-test subjects, an end-to-end list covering every feature, and eight required README topics.

**Why it works** — The Playwright list serves as product acceptance criteria: each clause names a flow and, often, an exact expected string. Matching those strings to earlier bold copy keeps implementation and tests aligned. The unit-test list identifies logic that must be testable in isolation.

**Use this** — Make the test list the definition of done, naming the flows and exact strings each test must find.

## Completion

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
>
> …
>
> 5. Reconcile `TECHNICAL_SPEC.md` against this instruction, fix every missing or incorrect requirement, and confirm each checked item has evidence.
>
> … Do not claim a check passed unless you ran it successfully.

**What it does** — [Defines a six-step exit procedure](/sample#completion): run five commands, walk each user journey in a browser, confirm persistence after restart, reconcile the checklist, and report the result.

**Why it works** — A fixed exit procedure replaces subjective completion with observable checks. It points back to the earlier checklist so every checked item requires evidence, and it prevents unverified results from being reported as complete.

**Use this** — End with a numbered exit procedure that reruns checks, reconciles the checklist, and forbids unsupported completion claims.

## Patterns that repeat

Across the document, the same patterns keep decisions explicit:

- Put exact interface strings in bold.
- Replace adjectives with measurable numbers.
- Use tables and ordered chains for behavior and precedence.
- Name excluded features and system invariants.
- Define required states for each feature.
- Treat runnable checks and a reconciled checklist as the completion boundary.

Review the patterns in the [Example PRD](/sample), then apply them with the [Template](/template).
