---
id: WP-171
title: Guide runtime hardening for identity, validation and deny list
wave: W1
lane: guide
risk: high
codex_effort: xhigh
depends_on: [WP-108]
fr: [FR-D4, FR-D7, E8]
owns:
  - packages/guide/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/guide typecheck
  - bun run --filter @lotse/guide test
  - bunx playwright install chromium
  - bun run --filter @lotse/guide e2e
pr_title: "fix(guide): harden target identity, typing checks and deny list"
---

# WP-171: Guide runtime hardening for identity, validation and deny list

## Goal

WP-108 landed the guide runtime after three attempts; its last Codex cross-review found the issues
below. Fix every one with the regression test it names, keeping all existing tests green. This WP
must land before any WP integrates the guide runtime (workspace, portal windows) and before M1.

## Context

- PRD §9 "Guide runtime" (deny list, visible typing, shadow DOM, allowlisted origins), FR-D4, FR-D7,
  §6 guided filling, §14 E8; `packages/guide/AGENTS.md`.
- The deny list stays data (`packages/guide/data/deny-list.json`), validated by its Zod schema.

## Findings to fix (from the WP-108 cross-review)

1. **major — Typing continues after its target identity changes.** [packages/guide/src/index.ts:121](packages/guide/src/index.ts:121)  
   The guard never verifies that the action’s handle still identifies the resolved field. In Chromium, changing `aria-label` and taking another snapshot issued a new handle, yet the old action continued typing and returned success. Approved personal data can therefore enter a repurposed field. **Required change:** revalidate the handle’s semantic identity before every write and abort with `target-not-found` when it changes. Add regressions for changes during pointing and between characters.

2. **major — Deferred portal validation produces false success.** [packages/guide/src/typing.ts:157](packages/guide/src/typing.ts:157)  
   The final value check runs before microtasks scheduled by page listeners. Chromium listeners using `queueMicrotask(() => field.value = "Portal replacement")` on `input`, `blur`, or `change` all left that replacement value while execution reported success. This violates AC3 and misreports data integrity. **Required change:** recheck the requested value after awaiting typing, once those event-handler microtasks have run, before returning success. Add deferred-handler regressions for typing and clearing.

3. **major — ARIA containers cause ordinary fields to be denied.** [packages/guide/src/index.ts:76](packages/guide/src/index.ts:76)  
   Every ancestor with `[role]` is treated as a control. Because `accessibleName()` also collects its descendant text, a `form role="form"` or `div role="group"` containing an “Absenden” button causes an unrelated name input to return `denied`. Chromium reproduced this for form, group, and region roles. **Required change:** apply ancestor denial to actionable controls, excluding container roles, and restrict name-from-content computation to appropriate roles. Add fixtures containing ordinary fields alongside denied buttons inside these containers.

4. **major — Image-based accessible names bypass label denial.** [packages/guide/src/snapshot/index.ts:80](packages/guide/src/snapshot/index.ts:80)  
   Reading only `textContent` loses descendant image alternatives. A button containing `<img alt="Delete record">` receives an empty snapshot label, and highlighting it returns success instead of `denied`. This breaks accessible naming and the destructive-control refusal contract. **Required change:** include descendant accessible names, including image `alt` text, when computing names from content. Add snapshot and denial regressions for image-only controls.

5. **major — English booking confirmation labels are missing.** [packages/guide/data/deny-list.json:14](packages/guide/data/deny-list.json:14)  
   The patterns recognize “booking” and “reservation” but omit English confirmation terms. Chromium accepted highlighting `<button type="button">Confirm appointment</button>`. The required book-confirm category is therefore incomplete. **Required change:** add English confirmation patterns covering final controls such as “Confirm appointment” and “Confirm reservation”, with refusal tests.

6. **minor — Clipped text incorrectly makes visible quotes ambiguous.** [packages/guide/src/targets.ts:45](packages/guide/src/targets.ts:45)  
   If any portion of a text node is visible, the entire node enters the quote index. A wrapped text node containing the same sentence twice, with its second line clipped by `overflow:hidden`, consequently returns `target-not-found` despite one unique visible occurrence. **Required change:** determine ambiguity from visible matching ranges, excluding fully clipped occurrences. Add this Chromium regression.

7. **minor — Inline-level boxes introduce nonexistent whitespace.** [packages/guide/src/targets.ts:37](packages/guide/src/targets.ts:37)  
   `inline-block` and `inline-flex` are classified as blocks. Adjacent inline-block spans rendering `Helloworld.` reject that exact quote but accept `Hello world.`, which the page does not contain. This violates exact matching after whitespace normalization. **Required change:** preserve inline-level boundaries without inserting spaces; add spaces only for actual block or explicit line breaks, with regression tests.

Typecheck and all 22 unit tests passed. The full e2e gate was blocked by sandbox `mkdtemp` restrictions; the findings above were reproduced separately in isolated Chromium.

## Acceptance criteria

- [ ] AC1: Each finding above is fixed and proven by the regression test it names (Chromium for
  DOM behaviour).
- [ ] AC2: All WP-108 acceptance tests stay green; all gates pass.

## Suggested commits

- `fix(guide): revalidate target identity and final values`
- `fix(guide): extend deny list for images and booking labels`
- `fix(guide): correct quote visibility and whitespace`
