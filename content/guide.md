---
title: "How to write a PRD an agent can build from"
description: "Seven practical rules for writing requirements that are specific, testable, and complete."
order: 2
---

A PRD is good when the builder can act without guessing and can prove the result is done. It should settle the decisions that shape the product, describe what people will see and do, and turn completion into evidence.

## Seven rules

<span id="1-start-with-the-mission-and-the-stop-condition"></span>

### 1. State the outcome and stop condition

Open with the result to produce, not the history behind it. Name the finished product, its essential scope, and the point at which the work should stop. Then make the rest of the PRD define that finish line. A clear outcome prevents a plan, prototype, or partial feature from being mistaken for the requested product.

> Build the complete application in this repository. Work autonomously from start to finish and stop only when the app is complete.

"Complete" becomes useful only when later sections define screens, behavior, constraints, and checks.

**Check:** Could a builder state the deliverable and the stop condition after reading the opening?

<span id="2-show-dont-describe"></span>

### 2. Show every important screen and state

Include a mock, wireframe, or exact layout description for every important screen. Cover more than the happy path. Show or describe empty, loading, validation, error, success, blocked, and signed-in states where they apply. Pair visuals with words for details an image cannot settle: responsive behavior, interaction order, content rules, and which parts may vary.

> Show truthful loading, empty, success, blocked, and error states. Errors must explain recovery. Never present failure as success.

A screenshot can establish shape and hierarchy. The text should explain what changes, what stays fixed, and what happens on small screens.

**Check:** Can every important screen and state be found in a visual or an exact description?

<span id="3-make-the-agent-write-its-own-checklist"></span>

### 3. Pin the stack and constraints

Name the required language, framework, runtime, package manager, storage layer, design system, and test tools. Record version or compatibility requirements when they matter. Also name tempting alternatives that are not allowed. Constraints should close meaningful design choices without dictating internal structure that has no effect on the result.

> SQLite with direct parameterized SQL through `better-sqlite3`; no ORM

Add operating constraints beside the stack: supported browsers, deployment target, offline needs, dependency limits, or an existing repository that must be extended.

**Check:** Does the PRD fix every technology and environment choice that must not drift?

<span id="4-pin-the-stack-and-name-the-alternatives-you-are-ruling-out"></span>

### 4. Write observable behavior exactly

Write requirements in terms a person or test can observe. List routes, actions, labels, validation rules, error text, ordering, redirects, timeouts, limits, and fallback behavior. Use exact strings and numbers where a difference would be visible. State precedence when several inputs can provide the same value.

> 404 page (everything else, including multi-segment paths): show the text **"Sorry, there's nothing at this address."**

Avoid adjectives such as "fast," "clean," or "intuitive" unless a measurable rule follows.

**Check:** Could each behavior be verified without asking what words such as "good" or "quick" mean?

<span id="5-be-exact-where-exactness-matters"></span>

### 5. State invariants and non-goals

Features say what the product does. Invariants say what must remain true across every feature and state. Write rules for ownership, authorization, data integrity, privacy, deletion, recovery, and trust boundaries. Then list non-goals that a helpful builder might otherwise add, especially familiar features that conflict with the intended scope.

> Deletion is **permanent**: the list's alias becomes immediately available to anyone. There is no soft delete, restore, tombstone, or anonymous list in this product.

Use direct declarations. Apply each invariant wherever it matters rather than attaching it to one screen. A non-goal should rule out real ambiguity, not become a backlog of unrelated ideas.

**Check:** Are cross-cutting rules and deliberately excluded features stated where they cannot be mistaken?

<span id="6-state-the-invariants-the-code-must-never-violate"></span>

### 6. Turn requirements into checks

For every requirement, name a practical verification method: a unit test, browser journey, command, inspection, or accessibility check. Keep the requirement and its evidence together in a checklist or test plan. This exposes vague language early and makes omissions visible before implementation begins.

> Use the format `- [ ] Requirement — Verify: method`. Maintain it throughout implementation.

Choose the narrowest check that proves the behavior. Use unit tests for logic and edge cases, browser tests for connected user flows, and direct inspection only when automation would not provide useful confidence. Keep unchecked work visible with its exact blocker.

**Check:** Does every requirement have a check that would clearly pass or fail?

<span id="7-define-done-as-checks-the-agent-can-run"></span>

### 7. Define done with commands and journeys

End with a completion procedure. Give the exact commands for formatting, linting, type checking, unit tests, browser tests, and production builds that the repository supports. Add real user journeys that connect multiple features, plus checks for restart behavior, persistence, responsive layouts, and failure recovery when those matter.

> Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`.

Commands prove individual gates; journeys prove the product works as a whole. Require an honest report of failures and incomplete items. Do not replace evidence with a broad phrase such as "production-ready."

**Check:** Is done defined by runnable commands and complete journeys rather than a judgement call?

## Vague vs. specific

| Vague | Specific |
|---|---|
| "fast" | Cap the fetch at 20 seconds. Failure keeps the link with whatever metadata was obtained (or none) and clears the row's progress bar; publication is never blocked by it. |
| "clean UI" | Design system: use Bulma CSS for every screen (layout, navbar, cards, buttons, modals, forms, tags, dropdowns) and Font Awesome for all icons. Do not add a custom design system or a second CSS framework. |
| "handles errors gracefully" | Show truthful loading, empty, success, blocked, and error states. Errors must explain recovery. Never present failure as success. |
| "secure" | Use a server-verifiable HTTP-only session cookie with an appropriate SameSite policy; use Secure in production HTTPS while allowing local HTTP development. |
| "mobile friendly" | Support current Chromium from desktop down to 320 CSS pixels with no page-level horizontal scrolling; the editor, modals, and public page must remain usable. |

Specific requirements name a number, state, mechanism, or result. Each right-hand example can become a check without another design conversation.

<!-- Compatibility headings keep the link checker aligned with the rendered aliases above.
###### 1. Start with the mission and the stop condition
###### 2. Show, don't describe
###### 3. Make the agent write its own checklist
###### 4. Pin the stack and name the alternatives you are ruling out
###### 5. Be exact where exactness matters
###### 6. State the invariants the code must never violate
###### 7. Define done as checks the agent can run
-->

## Before you hand it off

- [ ] Does the opening state the outcome and stop condition?
- [ ] Is every important screen and state shown or described exactly?
- [ ] Are the stack, environment, and meaningful constraints pinned?
- [ ] Are observable behaviors written with exact strings, numbers, and fallbacks?
- [ ] Are invariants and non-goals explicit?
- [ ] Does every requirement have a check that can pass or fail?
- [ ] Does the definition of done include exact commands and complete user journeys?

[Read the example PRD](/sample) · [Use the PRD template](/template)
