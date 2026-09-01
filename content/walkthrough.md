---
title: "The sample PRD, section by section"
description: "What each part of Build The Urlist does, why it works, and what to steal for your own PRD."
order: 3
---

[The sample](/sample), one section at a time: a verbatim excerpt, what it pins down, why that matters, and one line to steal. [The guide](/guide) names the seven habits these sections show; the [template](/template) turns them into a skeleton to fill in.

## Mocks

<!-- quote: not-gist -->
> Home Page  
> New List  
> New List: Validation States  
> Login Modal  
> My Lists (Logged In)  
> Published List  
> Published List: QR Code

**What it does** — The [Mocks section](/sample#mocks) opens the document: seven small headings, each followed by a screenshot of the reference app. The Urlist the PRD describes already has a reference — an app it calls "the reference" and whose screens these seven screenshots show — so the mocks are the target the agent is given, not what it built.

**Why it works** — A screenshot settles hundreds of layout questions at once: where menu items sit, how tall the vanity field is. Written out, they would take pages and still leave guesses, and every guess is a place the build drifts from what Burke wanted. The headings also name states, not just screens, so error rendering is specified rather than improvised.

**Steal this** — Lead with a named screenshot of every screen and every state you care about, before you write a word of spec.

*In the guide:* [Habit 2 — Show, don't describe](/guide#2-show-dont-describe).

## Technical specification and checklist

> Before coding, create and commit `TECHNICAL_SPEC.md`. …
>
> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation. Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it. …

**What it does** — [Before any code](/sample#technical-specification-and-checklist), the agent writes and commits its own spec, with one checkbox per requirement and a verification method on each.

**Why it works** — It makes the agent read the whole instruction and restate it as atomic items. One-shot builds usually fail on a forgotten decision, not a wrong one: the agent starts on the first feature and never returns to the twelfth. A checklist it wrote itself is the memory that prevents that, and `Verify: method` gives each item its own definition of done.

**Steal this** — Make the agent produce its own checkbox spec, with a verification method on every line, before it writes code.

*In the guide:* [Habit 3 — Make the agent write its own checklist](/guide#3-make-the-agent-write-its-own-checklist).

## Stack and design

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM
>
> …
>
> Design system: use Bulma CSS for every screen … and Font Awesome for all icons. Do not add a custom design system or a second CSS framework.

**What it does** — [Names every layer](/sample#stack-and-design): framework, language, database, test runners, CSS framework, icon set, runtime, and rules alternatives out: no ORM, not Edge, no second CSS framework.

**Why it works** — Stack choice is the largest single guess an agent makes, made in the first minute, before anything can be checked. Naming the exact libraries removes it, and the negatives close doors the agent would otherwise walk through on its own. Naming Bulma also gives every later visual instruction a shared vocabulary, down to `button is-fullwidth`.

**Steal this** — Name every library and runtime, and say which obvious alternatives are off the table.

*In the guide:* [Habit 4 — Pin the stack and name the alternatives you are ruling out](/guide#4-pin-the-stack-and-name-the-alternatives-you-are-ruling-out).

## Product

> Publishing requires a signed-in user; there is no anonymous publishing. … There is no soft delete, restore, tombstone, or anonymous list in this product.
>
> …
>
> The server is authoritative: revalidate input, ownership, and alias availability on every write; ignore client-supplied owner IDs.

**What it does** — [One sentence](/sample#product) on what the product is, then the rules that give it shape: who can publish, who owns a list, what deletion means, and that the server has the last word.

**Why it works** — Most of the section is about what the product is *not*. "There is no soft delete, restore, tombstone, or anonymous list" names four features an agent would plausibly add; named here, they are decisions it never has to make. Server authority, stated once up front, covers every later write. The first UI string, **"Login to Publish"**, is bold, a convention the sample keeps.

**Steal this** — Write the sentence that says what your product does not have, and list those features by name.

## Routes

> | Route | Behavior |
> |---|---|
> | … | … |
> | `/{vanity}` | Public list — **a single path segment only** |
>
> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**
>
> Static routes take priority over `/{vanity}`. Reserved first segments: `s`, `api`, `__test`.

**What it does** — [Six routes](/sample#routes) in a table with one line of behavior each, then the 404 copy, a priority rule, and three reserved first segments; the [Navigation bar](/sample#navigation-bar) subsection does the same for the menu.

**Why it works** — A route table is the cheapest way to make a surface unambiguous: the agent implements it row by row and knows when it is finished. Without the priority rule and reserved segments, `/s/new` against `/{vanity}` is a collision the agent would resolve on its own. The navbar gets the same treatment, down to "**only when signed in**" and the exact copy of the "Clear this list?" guard.

**Steal this** — Put every route in a table with one line of behavior, then say which routes win when patterns overlap.

*In the guide:* [Habit 5 — Be exact where exactness matters](/guide#5-be-exact-where-exactness-matters).

## Home page

> - … Validation: non-empty after trim; must parse as an absolute `http` or `https` URL … Invalid: apply the invalid input state and show **"That doesn't look like a valid URL"**

**Same move** — [The home page](/sample#home-page-1) puts every user-visible string in bold and writes validation as steps, trim then parse as an absolute URL, not as an adjective.

*In the guide:* [Habit 2 — Show, don't describe](/guide#2-show-dont-describe).

## Draft and editor

> **In-place editing (this is the key interaction):** the title, description, and URL are rendered as plain text — there are no visible input boxes, borders, field backgrounds, labels, or save buttons inside the row. …
>
> Reordering is **drag-and-drop only**, via the grip handle, … No other reorder affordances.

**What it does** — [Defines the draft](/sample#draft-and-editor) and the editor page, then two subsections: the [Publish bar](/sample#publish-bar), with its exact messages and enabled rules, and the [Link list editor](/sample#link-list-editor), with row anatomy and in-place editing.

**Why it works** — The sample flags the one interaction that matters most and describes it by what is absent: no input boxes, no borders, no labels, no save buttons. Listing what must not appear stops the agent from building the standard form it would otherwise reach for. The publish bar gives the alias rule as observable behavior, with exact error strings and a 300ms availability check.

**Steal this** — Mark the one interaction that matters most and describe it by what the user must not see as well as what they must.

*In the guide:* [Habit 2 — Show, don't describe](/guide#2-show-dont-describe) · [Habit 5 — Be exact where exactness matters](/guide#5-be-exact-where-exactness-matters).

## Live metadata

> - Title: `<title>` tag → `og:title` → `twitter:title` → first `<h1>` → `og:site_name`
>
> …
>
> The fetcher must be SSRF-safe: HTTP/HTTPS only, no credentials embedded, reject non-public and internal addresses, revalidate DNS on every redirect to prevent rebinding, follow at most five redirects, limit content to 2 MiB, accept only HTML/XHTML, and never forward app credentials. …

**What it does** — [When a link is added](/sample#live-metadata), the server fetches the destination and fills in title, description, and image, with a 20-second cap, a precedence per field, and a hardening checklist.

**Why it works** — An arrow chain is a precedence the agent can implement and test literally; without it, which tag wins is a guess. The SSRF paragraph turns what an agent knows about but does not reliably do into concrete checks. "Empty metadata is a successful result" settles the failure semantics so the feature cannot block publishing.

**Steal this** — Write fallback order as an explicit chain and security requirements as a checklist of individual checks.

## Aliases and publication

> An alias is **one segment** of letters, numbers, and hyphens (normalized to lowercase; 1–50 characters). It is globally unique among **active** lists …
>
> … generate an available 7-character random alias from lowercase letters and digits.

**Same move** — [The alias definition](/sample#aliases-and-publication) uses numbers instead of adjectives, 1–50 characters, 7 when generated, lowercase letters and digits, and leaves the agent nothing to pick.

*In the guide:* [Habit 5 — Be exact where exactness matters](/guide#5-be-exact-where-exactness-matters).

## Login and ownership

> 1. **"with Twitter/X"**
> 2. **"with GitHub"**
> 3. **"with Google"**
>
> … Each button signs in as a stable fictional user stored in SQLite; … Ownership is the (stable user ID, provider) pair, not the display name.

**What it does** — [A login modal](/sample#login-and-ownership) with three provider buttons that never call a real provider, backed by mock identities in SQLite and a server-verifiable session cookie.

**Why it works** — Real OAuth would have stalled the build on credentials the agent does not have. The sample replaces it with a mock specified tightly enough (at least two distinct users with stable IDs) that every login-dependent flow can still be built and tested. Ownership as the (user ID, provider) pair is a schema decision made for the agent in one sentence, and "401 on update/delete" gives the failure mode a testable status code.

**Steal this** — Replace a blocking dependency with a mock specified precisely enough that everything downstream can still be finished and tested.

*In the guide:* [Habit 6 — State the invariants the code must never violate](/guide#6-state-the-invariants-the-code-must-never-violate).

## My Lists

> - While loading: 3 skeleton tiles. …
>
> There is **no Deleted section and no Restore action**.

**Same move** — [My Lists](/sample#my-lists) is written in numbers, 1 to 4 columns by breakpoint and 3 skeleton tiles, then states an invariant as a rule: no Deleted section, no Restore action.

## Delete

> Clicking it opens a danger confirm modal with title **"Delete this list?"** and body **"The url {vanity} will be released for others to use."** …
>
> … There is no restore.

**Same move** — [Delete](/sample#delete) puts the exact user-visible strings in bold, down to the `{vanity}` placeholder, and restates the invariant where the agent reads it: there is no restore.

## Public list

> When the alias does not resolve to an active list, show the not-found state instead: … H2 **"We couldn't find that Urlist"**, and H3 **"But don't be sad! That means {vanity} is still available."** …

**Same move** — [The public list](/sample#public-list) spells out every state in exact bold strings, not-found included, and gives the rest as numbers: 5 skeleton rows, a 4x QR module scale, `#121212` on `#F9FAFC`.

## Theme, responsive UI, and accessibility

> Meet WCAG 2.2 AA, including full keyboard operation, reduced-motion support, sensible focus management, and announced status/error changes. …
>
> Show truthful loading, empty, success, blocked, and error states. …

**Same move** — [The theme and accessibility rules](/sample#theme-responsive-ui-and-accessibility) state invariants for the whole app, WCAG 2.2 AA and truthful states everywhere, and give a number, a 320 CSS pixel floor, not an adjective.

## Storage and security

> … Enable SQLite foreign keys. Use transactions for publish, save, delete, and reset.
>
> …
>
> Treat user text and fetched metadata as untrusted when rendering, …

**Same move** — [Storage and security](/sample#storage-and-security) states invariants as rules, not advice: foreign keys on, transactions on four named operations, fetched metadata treated as untrusted alongside user text.

*In the guide:* [Habit 6 — State the invariants the code must never violate](/guide#6-state-the-invariants-the-code-must-never-violate).

## Scripts, tests, and documentation

> Use Playwright for: the home page first-link flow (valid and invalid → "That doesn't look like a valid URL"); draft persistence across reload and logout; …
>
> Tests use a separate temporary database and must not depend on order.

**What it does** — [Nine npm scripts](/sample#scripts-tests-and-documentation) by name, the unit-test subjects, an end-to-end list covering every feature, and a README with eight required topics.

**Why it works** — The Playwright paragraph is the acceptance criteria for the whole product, written as one long list: each clause names a flow and, often, the exact string the test should find. Because those strings match the bold copy in earlier sections, a test cannot pass against paraphrased UI; the tests enforce the spec and catch an agent that drifted while building. The unit-test list tells the agent which logic must be pure enough to test in isolation.

**Steal this** — Write the test list as the definition of done, naming the flows and the exact strings each test must find.

*In the guide:* [Habit 7 — Define done as checks the agent can run](/guide#7-define-done-as-checks-the-agent-can-run).

## Completion

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
>
> …
>
> 5. Reconcile `TECHNICAL_SPEC.md` against this instruction, fix every missing or incorrect requirement, and confirm each checked item has evidence.
>
> … Do not claim a check passed unless you ran it successfully.

**What it does** — [A six-step exit procedure](/sample#completion): run the five commands, walk every user journey in a real browser, confirm a restart keeps the data, reconcile the checklist, then report.

**Why it works** — An agent decides for itself when it is done, and that is where a near one-shot build turns into a half-finished one: the agent stops where it believes the work is complete. This section replaces belief with a procedure that points back at the checklist from the second section, so every checked box needs evidence. The last sentence targets the failure mode agents actually have: reporting an intended action as done.

**Steal this** — End with a numbered exit procedure that re-runs the checks, reconciles the checklist, and forbids claiming a check that was not run.

*In the guide:* [Habit 1 — Start with the mission and the stop condition](/guide#1-start-with-the-mission-and-the-stop-condition) · [Habit 7 — Define done as checks the agent can run](/guide#7-define-done-as-checks-the-agent-can-run).

## Patterns that repeat

Each of these techniques removes a class of decisions the agent would otherwise make alone, and the fewer of those there are, the closer the build gets to one shot.

- **Exact strings in bold.** See *Same move* under Home page, Delete, and Public list.
- **Numbers instead of adjectives.** See *Same move* under Aliases and publication, My Lists, Public list, and Theme, responsive UI, and accessibility.
- **Tables and chains for precedence.** The route table with its priority rule; the metadata fallback chains: Routes, Live metadata.
- **Naming what is not in the product.** No ORM, no anonymous publishing, no soft delete, no restore, no tombstone: Stack and design, Product, Draft and editor, My Lists, Delete, Public list.
- **Server authority.** Revalidate on every write, ignore client-supplied owner IDs, trust only the server session: Product, Aliases and publication, Login and ownership, Storage and security.
- **States required everywhere.** Loading, empty, error, and not-found states specified per feature, then required globally: Draft and editor, My Lists, Public list, Theme, responsive UI, and accessibility.
- **Tests as the definition of done.** Unit-test subjects, an end-to-end list naming flows and strings, and an exit step that runs them: Scripts, tests, and documentation, Completion.
- **A self-maintained checklist.** The agent writes its own spec first, checks items only with evidence, and reconciles it before finishing: Technical specification and checklist, Completion.
