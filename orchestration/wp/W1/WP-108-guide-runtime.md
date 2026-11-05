---
id: WP-108
title: Guide runtime with page snapshot, pointing, visible typing and deny list
wave: W1
lane: guide
risk: high
codex_effort: xhigh
depends_on: [WP-003]
fr: [FR-D4, FR-D7, FR-C3, E8]
owns:
  - packages/guide/**
may_touch:
  - bun.lock
allow_deps: "`@lotse/protocol` as `workspace:*` and `zod@^4` (same version as protocol) in `@lotse/guide`"
live_services: []
gates:
  - bun run --filter @lotse/guide typecheck
  - bun run --filter @lotse/guide test
  - bunx playwright install chromium
  - bun run --filter @lotse/guide e2e
pr_title: "feat(guide): add guide runtime with snapshot, pointing and visible typing"
---

# WP-108: Guide runtime with page snapshot, pointing, visible typing and deny list

## Goal

`packages/guide` becomes the page runtime that the workspace (browser) and the Mac app's guided
portal window inject into web pages. It snapshots the page's interactive elements with stable
handles, points at and highlights targets, types approved values visibly, and refuses to touch
submit-like controls. It is the resolution method for `dom` targets and `text` quotes in pages, and
the basis of E8 pointing tests.

## Context

- PRD §9 "Guide runtime" (all bullets), "Target resolution ladder" (step 2 page handles), "Speech
  and action synchronization"; §6 flow for guided portal filling; FR-D4, FR-D7, FR-C3; §14 E8.
- PRD §17 `packages/guide` invariants: deny list is data, not code; no network calls; shadow DOM only.
- Protocol (WP-003, `@lotse/protocol`): `Action` (kinds `point`, `highlight`, `annotate`, `caption`,
  `type`, `clear`), `Target` (`dom` with `handle` and `url`; `text` with `quote`), `ContextCapsule.page`
  (`url`, `handles[] { id, role, label, value, bbox }`), `ActionResult` (`resolvedBy: "dom"`).
- The allowlist file `packages/knowledge/allowlist.yaml` does not exist yet (WP-103). The runtime
  receives the allowlist as configuration.

## Scope

In scope: snapshot, overlay rendering, action execution, typing, deny list, origin gate, a typed
public API, fixture pages and Playwright tests in real Chromium.

Out of scope: the injection bundle for `WKUserScript` (later WP), the workspace integration
(WP-007/WP-112), the Mac portal window (WP-009+), network access of any kind.

## Deliverables

1. **Public API** in `src/index.ts`: `createGuide({ allowlist, denyList, document? })` returning
   `{ snapshot(), execute(action), clear(), dispose() }`. `execute` returns a protocol `ActionResult`.
2. **Snapshot** (`src/snapshot/**`): interactive elements (inputs, selects, textareas, buttons,
   links, ARIA widgets) with a stable `handle` (stable across re-snapshots of an unchanged DOM;
   derived from structure and accessible name, not random), role, accessible name as `label`,
   current `value` (never for `type=password`), `visible`, and `bbox` normalized 0..1 to the
   viewport. This internal `PageSnapshot` type keeps `visible`; `toCapsulePage(snapshot)` projects
   it to the frozen protocol shape `ContextCapsule.page` by keeping only visible elements and
   dropping the extra field. Do not change `@lotse/protocol`.
3. **Overlay** (`src/overlay/**`): cursor, highlight, annotation and caption rendered in a closed
   shadow root attached to one host element, with styles inside the shadow root; page CSS cannot
   restyle it and page scripts cannot query its content. `clear()` removes everything.
4. **Targets**: resolve `dom` targets by handle (re-snapshot if stale) and `text` targets by finding
   the quote in visible text (whitespace-normalized, exact otherwise) and highlighting its range.
   Unresolvable targets return `success: false` with a `failureReason`.
5. **Visible typing** (`type` action): move the cursor to the field, focus it, enter the value
   character by character at the action's `pace` with the events frameworks expect (`beforeinput`,
   `input`, `keydown`/`keyup`, `change` on blur), using the native value setter so React-controlled
   inputs update. `clear` empties a field the same way. L1 ghost preview: an option that renders the
   value as an overlay next to the field without typing it.
6. **Deny list** as data (`data/deny-list.json`, validated by a Zod schema at load): roles, input
   types and German and English label patterns for submit, send, pay, book-confirm and delete
   controls. The runtime never clicks or types into a denied control and reports
   `failureReason: "denied"`. No code path dispatches `click` or form `submit`.
7. **Origin gate**: every mutating action checks `location.origin` against the configured allowlist
   and refuses otherwise.
8. **Tests**: Vitest unit tests (jsdom or happy-dom only if already available; otherwise keep unit
   tests DOM-free) and Playwright e2e (`e2e` script, `playwright.config.ts`, Chromium) against local
   fixture HTML pages served from `test/fixtures/` (plain form, React-like controlled input via a
   small inline script, German portal-style form with "Absenden"/"Jetzt bezahlen" buttons, page that
   tries to restyle and read the overlay). These are the first E8 fixtures.
9. **Docs**: update `packages/guide/AGENTS.md` (commands incl. `e2e`, invariants) and `README.md`.

## Acceptance criteria

- [ ] AC1: `toCapsulePage` of each fixture snapshot validates against `ContextCapsule.page` and
  omits hidden elements; handles are identical
  across two snapshots of an unchanged page and survive an unrelated DOM insertion.
- [ ] AC2: `point` and `highlight` on a `dom` handle and on a `text` quote place the overlay over the
  element's or text range's bounding box (within 2 px) in Chromium.
- [ ] AC3: `type` fills a plain input and a controlled input; the page's own listeners observe every
  character and the final value equals the payload value; pace is respected within tolerance.
- [ ] AC4: Every deny-list fixture control is refused with `failureReason: "denied"`, in German and
  English; a static test asserts no `click()`/`submit()`/`requestSubmit()` call exists in `src/`.
- [ ] AC5: Page scripts cannot find overlay nodes via `document.querySelector*`, and page CSS
  (`* { display:none !important }` etc.) does not hide the overlay.
- [ ] AC6: Actions on a non-allowlisted origin are refused; `src/` contains no `fetch`,
  `XMLHttpRequest`, `WebSocket` or `sendBeacon` use (static test).

## Notes for the implementer

- Use the accessible-name computation rules (aria-labelledby, aria-label, label[for], wrapping label,
  placeholder last) and document them.
- For React-controlled inputs, set the value through `Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, "value").set` before dispatching `input`.
- Keep the package free of Node-only APIs in `src/`; it runs in browsers.

## Suggested commits

- `feat(guide): add page snapshot with stable handles`
- `feat(guide): add shadow dom overlay and target resolution`
- `feat(guide): add visible typing with deny list and origin gate`
- `test(guide): add playwright fixtures for pointing and typing`
