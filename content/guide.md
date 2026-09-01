---
title: "How to write a PRD an agent can build from"
description: "Seven habits that separate a PRD an agent can execute from one it has to guess at."
order: 2
---

Burke Holland reports that a coding agent given the sample PRD, [*Build The Urlist*](/sample), built the app in one shot, or close to it. That is this site's claim, and the sample is its proof: the agent builds what you wrote and guesses at every gap, so a PRD specific enough gets built in one pass.

This guide covers the habits that make a PRD that specific; the [walkthrough](/walkthrough) shows them at work in the sample, and the [template](/template) gives you the skeleton.

## Who is reading your PRD now

A PRD written for a human PM starts a conversation. Someone asks what happens when the alias is already taken, someone else asks whether a deleted list can be restored, and the document gets better over three meetings. The gaps are fine, because people fill them.

A PRD written for an agent *is* the conversation. There is no review meeting. The agent reads the document once, then starts making decisions, and every decision you did not make in writing it will make for you: which framework, which error message, whether deletion is soft or permanent, what *done* means. Some guesses will be reasonable; you will not find out which were not until you open the finished app.

The gist knows this from its first line. Before any feature, before the stack, it tells the agent what the job is and when to stop: "Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete." Two sentences, and the agent knows it is not writing a plan, not waiting for sign-off, and not stopping at a prototype.

That changes what a good PRD looks like. The problem statement and market context a human reviewer expects are worth nothing to a reader that cannot ask a question. What replaces them is precision: exact strings, exact numbers, rules about what must never happen, and a definition of finished that the agent can check for itself.

## Seven habits

### 1. Start with the mission and the stop condition

The first thing an agent reads should tell it what to produce and how it will know it is finished. Not the background or the audience: the job. The gist does this in its opening line without padding.

> Build the complete application in this repository.
> Work autonomously from start to finish and stop only when the app is complete.

Both halves matter. "Build the complete application" rules out a scaffold or a plan. The instruction to "stop only when the app is complete" rules out pausing to ask whether the approach is right. The rest of the document defines *complete*, ending with a Completion section that turns the stop condition into checks (habit 7).

Without it, an agent unsure of its mandate stops early, delivers a partial build with a list of *next steps*, or asks a question nobody is there to answer.

*See it:* [the opening line](/sample) and [Completion](/sample#completion) in the sample · [the walkthrough on completion](/walkthrough#completion).

### 2. Show, don't describe

Layout is the most expensive thing to specify in prose and the cheapest to show. The gist opens with a Mocks section of seven screenshots (Home Page, New List, New List: Validation States, Login Modal, My Lists (Logged In), Published List, Published List: QR Code), and the text refers back to "the reference" whenever a visual decision would otherwise take a paragraph.

> Not a card. A full-width band directly under the navbar, on a background distinct from the page body below it (the reference separates it with a soft shadow).
> Three columns on desktop, stacked on mobile:

The mock anchors the shape; the sentence settles what a screenshot leaves ambiguous: a band, not a card, separated by a shadow, stacking on mobile. Words can also say how much is negotiable. For the Get Started band the gist writes "a full-width band with a subtle rounded or straight top edge is fine", so the agent does not have to guess how faithfully to copy the picture.

Without it, the agent produces a layout that complies with every sentence you wrote and looks nothing like what you meant.

*See it:* [Mocks](/sample#mocks), [Home page](/sample#home-page-1) and [Draft and editor](/sample#draft-and-editor) in the sample · [the walkthrough on mocks](/walkthrough#mocks).

### 3. Make the agent write its own checklist

Before it writes any product code, the gist has the agent produce a second document, `TECHNICAL_SPEC.md`, that turns every requirement into a checkbox with a stated way to verify it. The PRD stays the source of truth; the checklist is the agent's working copy, with rules for keeping it honest.

> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation.
> Check an item only after its implementation exists and its verification passes; reopen it if later work breaks it.
> Before finishing, resolve every unchecked item or leave it unchecked and report the exact blocker.

This does three things. It forces the agent to read the whole PRD before coding. It makes the verification method, "unit test, browser test, command, or direct inspection", an up-front decision rather than an afterthought. And it leaves you a document to audit line by line against your own.

Without it, requirements buried in the middle of a long section get silently dropped, and you find out by using the app.

*See it:* [Technical specification and checklist](/sample#technical-specification-and-checklist) in the sample · [the walkthrough on the checklist](/walkthrough#technical-specification-and-checklist).

### 4. Pin the stack and name the alternatives you are ruling out

An agent will choose a stack if you do not, and a different one on a different day. The gist names every layer, then does what most PRDs skip: it names what it is *not* allowing, which is where an agent's defaults would otherwise take over.

> - Next.js App Router, React, strict TypeScript, Node.js, and npm
> - SQLite with direct parameterized SQL through `better-sqlite3`; no ORM
> - Vitest and Playwright
> - Current stable package versions and a committed `package-lock.json`
>
> Use the Node.js runtime, not Edge, for SQLite, sessions, file access, and metadata fetching.
>
> Design system: use Bulma CSS for every screen (layout, navbar, cards, buttons, modals, forms, tags, dropdowns) and Font Awesome for all icons. Do not add a custom design system or a second CSS framework.

"no ORM", "not Edge", no "second CSS framework": each closes a door the agent would otherwise walk through the moment it hit friction. The runtime rule is the sharpest: SQLite and file access do not work on Edge, and an agent that picked it for a route handler would burn an hour before switching.

Without it, you get a dependency you never wanted, a design system layered on top of the one you asked for, or a runtime that cannot open the database.

*See it:* [Stack and design](/sample#stack-and-design) in the sample · [the walkthrough on stack and design](/walkthrough#stack-and-design).

### 5. Be exact where exactness matters

Some things a user or a test would notice if they were off by one word or one pixel. For those, the gist gives the exact value, bolded, in quotation marks. The Publish button reads "Login to Publish". A bad URL gets "That doesn't look like a valid URL". The 404 page shows one sentence and nothing else.

> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**

The same discipline applies to numbers. Every limit is a number: a random alias is 7 characters; a metadata fetch is capped at 20 seconds; the fetcher follows at most five redirects and reads at most 2 MiB; the link image is 64px; the layout works down to 320 CSS pixels; a vanity alias is 1–50 characters.

> If the alias is blank at publication, generate an available 7-character random alias from lowercase letters and digits.

The rule: be exact when a user or a test would notice, free otherwise. The routes table lists every path, because a test will hit each one. The terms page gets "reasonable content is fine", because nobody will assert on its text.

Without it, every string is a paraphrase, every limit is whatever the library defaulted to, and your end-to-end tests fail on text you did not write.

*See it:* [Routes](/sample#routes) and [Draft and editor](/sample#draft-and-editor) in the sample · [the walkthrough on routes](/walkthrough#routes).

### 6. State the invariants the code must never violate

Features describe what the app does. Invariants describe what it must never do, whichever feature is running. An agent cannot infer them from a screenshot, and breaking one produces the bugs that matter: data owned by the wrong user, a deleted list that comes back, a server that trusts the browser. The gist states them as flat declarations.

> The server is authoritative: revalidate input, ownership, and alias availability on every write; ignore client-supplied owner IDs.

> Deletion is **permanent**: the list's alias becomes immediately available to anyone. There is no soft delete, restore, tombstone, or anonymous list in this product.

Notice the form. "The server is authoritative" applies to every write, not one endpoint. Ownership is a data structure, "the (stable user ID, provider) pair, not the display name", so no later feature can key on a name. The deletion rule lists what must not exist, because an agent has seen thousands of apps with a restore button and would otherwise add one as a courtesy. The fetcher's security rules get the same treatment: one sentence, every check.

> The fetcher must be SSRF-safe: HTTP/HTTPS only, no credentials embedded, reject non-public and internal addresses, revalidate DNS on every redirect to prevent rebinding, follow at most five redirects, limit content to 2 MiB, accept only HTML/XHTML, and never forward app credentials. Empty metadata is a successful result.

Without it, you get a fetcher that can reach your internal network, a Deleted section nobody asked for, and an ownership check that lives in the browser.

*See it:* [Login and ownership](/sample#login-and-ownership) and [Storage and security](/sample#storage-and-security) in the sample · [the walkthrough on patterns](/walkthrough#patterns-that-repeat).

### 7. Define done as checks the agent can run

The stop condition from habit 1 only works if the agent can tell when it has been met. The gist's last section is a numbered procedure: commands to run, a production build to start, journeys to complete in a real browser, a restart to survive, and the habit 3 checklist to reconcile against the original.

> 1. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.
> 2. Start the production build and confirm the app responds.

Step three lists every user journey to complete "In a real Chromium browser"; the rest close the loop on persistence, the spec, and honesty about what was run.

> 4. Confirm active data survives a complete restart.
> 5. Reconcile `TECHNICAL_SPEC.md` against this instruction, fix every missing or incorrect requirement, and confirm each checked item has evidence.
> 6. Repeat affected validation and leave no unchecked item unless it has a reported external blocker.
>
> Report what you built, assumptions, architecture, exact command results, and anything incomplete with its reason. Do not claim a check passed unless you ran it successfully.

Each of these is a check, not a judgement. *The app should be production-ready* cannot be run; `npm run build` can. The last sentence gives the agent a way to fail honestly, which matters, because an agent told to finish will otherwise report success.

Without it, the agent declares itself done at the point where the code compiles, and the first real browser session finds that the login modal does not open.

*See it:* [Completion](/sample#completion) and [Scripts, tests, and documentation](/sample#scripts-tests-and-documentation) in the sample · [the walkthrough on completion](/walkthrough#completion).

## What to leave out

Everything you add is something the agent has to read, weigh, and possibly misapply. The gist specifies a full application in under four thousand words by leaving out four kinds of material.

**Rationale the agent does not need.** The gist never explains why publishing requires login, why deletion is permanent, or why an alias is limited to 50 characters. It states the rule. If a reason changes how the rule is applied, include it; if it only justifies the rule to a human reviewer, leave it out.

**The stack, repeated.** The stack is stated once. The Routes table does not mention Next.js, the Delete section does not mention SQLite, the My Lists section does not mention React; the agent knows. The gist applies the same rule to the document the agent writes for itself: "Keep it concise; do not restate this document."

**Implementation detail where you only care about behaviour.** The gist gives the metadata precedence, because the precedence is observable and testable:

> - Description: `og:description` → `twitter:description` → `meta[name=description]`

It says nothing about which HTML parser to use or how to structure the module, because no user sees that and no test asserts it. The fallback order is what the unit tests check; the parser is the agent's problem.

**Anything you would not test.** If a sentence in your PRD would never become a checkbox in `TECHNICAL_SPEC.md`, ask what it is doing there. *The UI should feel modern* produces no checkbox. "Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling" produces one, with a browser test as the method.

## Vague vs. buildable

Left: the line most product documents contain. Right: what the gist wrote instead, quoted verbatim.

| Vague | Buildable |
|---|---|
| "fast" | Cap the fetch at 20 seconds. Failure keeps the link with whatever metadata was obtained (or none) and clears the row's progress bar; publication is never blocked by it. |
| "clean UI" | Design system: use Bulma CSS for every screen (layout, navbar, cards, buttons, modals, forms, tags, dropdowns) and Font Awesome for all icons. Do not add a custom design system or a second CSS framework. |
| "handles errors gracefully" | Show truthful loading, empty, success, blocked, and error states. Errors must explain recovery. Never present failure as success. |
| "secure" | Use a server-verifiable HTTP-only session cookie with an appropriate SameSite policy; use Secure in production HTTPS while allowing local HTTP development. |
| "mobile friendly" | Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling; the editor, modals, and public page must remain usable. |
| "users can log in" | This app is local and must not call any real identity provider. Each button signs in as a stable fictional user stored in SQLite; map each provider button to a distinct mock identity (at least two distinct users total) and render that user's name and avatar in the navbar. |
| "validate the URL" | Validation: non-empty after trim; must parse as an absolute `http` or `https` URL (a bare domain-like value may be prefixed with `http://`); the host (after stripping a leading `www.`) must be a DNS-like host containing at least one dot. |
| "good test coverage" | Use Vitest for URL and alias validation, random alias generation, metadata parse precedence (title/description/image including the favicon fallback), ownership, SQLite transactions, and share URL construction. |

Every right-hand line names a number, a list of states, a mechanism, or a set of things to test. None uses an adjective two people could read differently, and each can become a `- [ ] Requirement — Verify: method` line without further interpretation.

## Pre-flight checklist

Read your PRD once the way the agent will: front to back, no questions allowed. Then answer these ten questions. Every no is a decision you are delegating.

1. Does the first paragraph state the mission and the stop condition?
2. Is there a mock, or an exact layout rule, for every screen the user will see?
3. Is the stack pinned by name, including the alternatives you are ruling out?
4. Is every user-visible string (labels, errors, headings, placeholders) written out exactly?
5. Is every route listed, with what it shows and what happens for everything else?
6. Is every limit a number: timeouts, sizes, lengths, redirect counts, breakpoints?
7. Are the invariants stated as rules the code must never break, including what must not exist?
8. Is there a named list of what the unit tests and the browser tests must cover?
9. Are the completion checks commands and journeys the agent can run, not qualities the result should have?
10. Is every open question resolved, with nothing marked *TBD*, *to be decided*, or *later*?

Ten yeses means the agent can start.

## Start writing

Copy the skeleton on the [template page](/template); it has a slot for every habit above. Then read the [walkthrough](/walkthrough), which takes the sample PRD section by section and shows how each decision was made.

The sample PRD was not written in one sitting: it went through more than a dozen revisions over three weeks, and its biggest revision cut far more than it added. [See how it evolved](/history) — what grew, what was rewritten, and when.
