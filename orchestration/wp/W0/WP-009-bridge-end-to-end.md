---
id: WP-009
title: Bridge end to end with the real workspace and a live turn
wave: W0
lane: bridge
risk: high
codex_effort: xhigh
depends_on: [WP-007, WP-008]
fr: [FR-C3, FR-C9, NFR-1, NFR-3]
owns:
  - apps/mac/Packages/LotseKit/Sources/LotseBridge/**
  - apps/mac/Packages/LotseKit/Sources/LotseOverlay/**
  - apps/mac/Packages/LotseKit/Sources/LotseCapture/**
  - apps/mac/Packages/LotseKit/Tests/LotseBridgeTests/**
  - apps/mac/App/**
  - apps/mac/E2E/**
  - apps/web/src/bridge/**
  - apps/web/src/conversation/adapters/**
  - apps/web/e2e/bridge/**
may_touch:
  - apps/mac/project.yml
allow_deps: none
live_services: [openai]
gates:
  - docker compose up -d --wait
  - pnpm --filter @lotse/brain db:migrate
  - pnpm --filter @lotse/web test
  - swift test --package-path apps/mac/Packages/LotseKit
  - bash apps/mac/E2E/run-bridge-e2e.sh
pr_title: "feat(bridge): connect mac app to the live workspace end to end"
---

# WP-009: Bridge end to end with the real workspace and a live turn

## Goal

This proves the architecture of PRD §7: the Mac app hosts the real workspace, and a turn travels
Mac → bridge → workspace → `/api/turn` → model → workspace → bridge → Mac.

- A display action and a client tool round-trip work over the bridge.
- This is the M0 proof that one conversation client and a capability-provider Mac app work together.

## Context

- PRD §7 "Key flows" 1 and 4, §9 "Protocol" (bridge messages), "Mac app", "Web workspace".
- WP-007: web side of the bridge and the `mac` transport adapter. WP-008: native bridge and workspace
  window.

## Deliverables

1. **Development menu item** (DEBUG builds only): "Send test transcript…". It sends a `Transcript`
   envelope (`final: true`) with typed text, and a `ContextCapsule` that has no screen.
   - This is a real path, used until push-to-talk voice arrives in W1 (WP-109). It is compiled out of
     release builds.
2. **Captions.** The workspace forwards `SpeechSegment` envelopes to Swift. Swift shows each segment
   in Clicky's speech bubble next to the cursor (caption only; TTS arrives in W1).
3. **Display action.** `ui.caption` and `ui.point` actions arrive over the bridge.
   - `ui.point` with a `point` target animates Clicky's cursor to the given screen coordinates.
   - Swift replies with an `ActionResult` (`resolvedBy: vision` for a `point` target), which the
     workspace attaches to the next `TurnRequest`.
4. **Client tool `context.readScreen`.**
   - The workspace forwards the `ToolInvocation`. Swift captures the main display with ScreenCaptureKit
     (`SCScreenshotManager`), runs Vision OCR (`RecognizeTextRequest`, accurate, de-DE) and returns a
     `ContextCapsule` fragment with OCR lines and normalized boxes.
   - The workspace returns it with `addToolOutput`.
   - Without the Screen Recording permission, Swift returns a typed `permission_missing` error output.
5. **E2E harness.** `apps/mac/E2E/run-bridge-e2e.sh`:
   - starts the web app (`next start` after build) against the work package's database;
   - runs an XCTest UI or integration test. In it, the workspace `WKWebView` obtains its anonymous
     session on first load (no cookie injection), and the test drives the flow above with a live model;
   - asserts:
     - `BridgeHello` arrives, and `ClientHello` reports `clientKind: mac` with the capabilities;
     - the test transcript yields at least one `SpeechSegment` delivered to Swift;
     - an `ActionResult` is recorded on the persisted turn;
     - `context.readScreen` returns either OCR lines (permission granted) or `permission_missing`;
       both are valid outcomes, logged by the test;
   - stops everything it started.
6. **Docs.** Update `apps/mac/AGENTS.md` and `apps/mac/README.md`: how to run the E2E test, and that
   granting Screen Recording to the test host is a one-time manual step for the owner.

## Acceptance criteria

- [ ] AC1: The E2E run passes against the live model. The persisted turn contains the transcript
  message, the assistant text, and the action result.
- [ ] AC2: Hiding the workspace window during the turn does not stall it
  (`inactiveSchedulingPolicy = .none`). The E2E test hides the window before sending.
- [ ] AC3: A bridge message from a non-workspace origin is rejected (kept from WP-008, re-run here).
- [ ] AC4: The DEBUG-only menu item is absent from a Release build (build-setting test or compile-time
  check).

## Notes for the implementer

- Launching UI tests and ScreenCaptureKit may not work in your sandbox. List those gates under
  `not_run`; the orchestrator runs them on the owner's Mac.

## Suggested commits

- `feat(bridge): forward speech segments and actions to the companion`
- `feat(mac): show captions and point the cursor from bridge actions`
- `feat(mac): add screen capture with on-device ocr as a client tool`
- `test(bridge): add live end-to-end test from transcript to companion`
