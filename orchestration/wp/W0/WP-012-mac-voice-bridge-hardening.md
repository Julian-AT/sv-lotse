---
id: WP-012
title: Mac voice and bridge hardening
wave: W0
lane: mac
risk: high
codex_effort: high
depends_on: [WP-008, WP-011]
fr: [FR-C1, FR-C5, NFR-10]
owns:
  - apps/mac/Packages/LotseKit/Sources/LotseVoice/**
  - apps/mac/Packages/LotseKit/Sources/LotseBridge/**
  - apps/mac/Packages/LotseKit/Sources/LotseCore/**
  - apps/mac/Packages/LotseKit/Tests/LotseVoiceTests/**
  - apps/mac/Packages/LotseKit/Tests/LotseBridgeTests/**
  - apps/mac/Packages/LotseKit/Tests/LotseCoreTests/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - cd apps/mac && xcodegen generate
  - swift test --package-path apps/mac/Packages/LotseKit
  - xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
  - swiftlint lint --strict --config apps/mac/.swiftlint.yml apps/mac/Packages
pr_title: "fix(mac): harden push-to-talk shortcut, release-to-send and bridge hello"
---

# WP-012: Mac voice and bridge hardening

## Goal

Fix the voice and bridge behaviour found by the second WP-008 cross-review
(`.orchestration/runs/WP-008/attempt-2/xreview.md`), and validate inbound bridge messages with the
generated Swift validation from WP-011.

## Deliverables

1. **Shortcut does not collide with VoiceOver.** Control-Option is VoiceOver's modifier. Choose a
   non-conflicting default (document why), persist a user-configurable shortcut (settings in the
   menu-bar UI, stored in `UserDefaults`), and test that VoiceOver command sequences
   (Control-Option plus keys) never start recording.
2. **Release-to-send.** An early `final` from the recognizer while the key is still held must not send.
   Keep the text, stop input, and emit exactly one final transcript from the release path; cancel
   before release sends nothing. Tests for both.
3. **Bridge hello survives a late receiver.** After `didFinish`, wait (bounded, scoped to the current
   navigation, cancelled on a new navigation) until `window.__lotse.receive` exists, then send
   `BridgeHello`; queue or refuse other messages until the hello succeeded. WebKit test that installs
   the receiver after page load.
4. **Inbound validation.** Decode workspace messages with WP-011's `decodeValidated` and reply with a
   rejection for invalid ones; WebKit tests for an empty id and a negative sentence index.

## Acceptance criteria

- [ ] AC1–AC4: each deliverable proven by the named tests; all gates pass.
- [ ] AC5: Bridge isolation from WP-008 unchanged (workspace origin and main frame only; guided
  windows without handlers).

## Suggested commits

- `fix(voice): avoid voiceover shortcut and keep release-to-send`
- `fix(bridge): wait for the page receiver and validate inbound messages`
