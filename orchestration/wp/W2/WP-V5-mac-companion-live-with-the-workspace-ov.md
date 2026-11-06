---
id: WP-V5
title: Mac companion live with the workspace, overlay pointing and cursor
wave: W2
lane: mac
risk: high
codex_effort: xhigh
depends_on: [WP-012, WP-V4]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - apps/mac/App/**
  - apps/mac/Packages/LotseKit/Sources/LotseOverlay/**
  - apps/mac/Packages/LotseKit/Sources/LotseBridge/**
  - apps/mac/Packages/LotseKit/Sources/LotseResolver/**
  - apps/mac/Packages/LotseKit/Sources/LotseCapture/**
  - apps/mac/Packages/LotseKit/Tests/**
  - apps/mac/E2E/**
may_touch:
  - bun.lock
  - packages/brain/package.json
  - apps/web/package.json
allow_deps: what the slice needs at the versions the repository uses; document additions
live_services: []
gates:
  - cd apps/mac && xcodegen generate
  - swift test --package-path apps/mac/Packages/LotseKit
  - xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
pr_title: "feat(mac): drive the companion overlay from the live workspace"
---

# WP-V5: Mac companion live with the workspace, overlay pointing and cursor

## Goal and deliverables

Make the Clicky-based companion work with the real workspace: the hidden workspace window loads the
web app (configurable URL, default the local dev server), the bridge exchanges protocol envelopes,
and incoming `Action`s drive the overlay: the cursor flies to targets and points, highlights and
annotates (Clicky's cursor animation and bubble), resolving `ui`/`form` targets through
`TargetRect` from the workspace and `ax`/`text` targets through the Accessibility tree and Vision OCR
line boxes (resolver methods 3 and 4; method 5 vision fallback may stay a stub behind a flag). The
cursor flies to each form field while the workspace types (FR-D5). Screen capture on hotkey sends a
`ContextCapsule` with the transcript. Supersedes WP-009, WP-110 and WP-203.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: E2E script (apps/mac/E2E) launches the app against the local workspace, sends a scripted turn and
  asserts the overlay received and resolved a point action (logs or test hook).
- [ ] AC2: xcodebuild build and test pass; SwiftLint strict passes.

## Suggested commits

- `feat(mac): drive the companion overlay from the live workspace`
