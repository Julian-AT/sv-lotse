---
id: WP-008
title: Mac app shell from Clicky with LotseKit modules and the native bridge
wave: W0
lane: mac
risk: high
depends_on: [WP-003]
fr: [FR-C1, FR-C2, FR-C3, FR-C7, NFR-10, NFR-11]
owns:
  - apps/mac/**
may_touch: []
allow_deps: Swift packages already used by Clicky (Sparkle); PostHog Swift SDK if Clicky uses it
live_services: []
gates:
  - cd apps/mac && xcodegen generate
  - swift test --package-path apps/mac/Packages/LotseKit
  - xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
  - swiftlint lint --strict --config apps/mac/.swiftlint.yml apps/mac/Packages
pr_title: "feat(mac): add clicky-based shell with lotsekit and native bridge"
---

# WP-008: Mac app shell from Clicky with LotseKit modules and the native bridge

## Goal

`apps/mac` contains the Clicky-derived menu-bar app, restructured for parallel work, with the native
half of the bridge in place:

- XcodeGen generates the project;
- the code lives in a local Swift package (`LotseKit`) with one module per capability;
- the generated protocol types are consumed from `packages/protocol/swift`;
- a `WKWebView` workspace window is wired to a validated, origin-restricted bridge.

## Context

- PRD §9 "Mac app": module table with the Clicky files reused, what is removed, the workspace window and
  bridge, the guided portal window.
- PRD §13 "Bridge isolation" and macOS specifics.
- Clicky: https://github.com/farzaa/clicky (MIT). Import it as plain files: no git history, no
  submodule. The owner must remain the only commit author.
- Why XcodeGen plus a Swift package: parallel work packages add files without touching a shared
  `.pbxproj`. The generated `.xcodeproj` is git-ignored.

## Deliverables

1. **Import.** Clicky's app sources go into `apps/mac/App/`.
   - `apps/mac/THIRD_PARTY_NOTICES.md` contains the upstream MIT license text, the copyright line and
     the upstream commit SHA you imported.
   - Do not import the `worker/` directory.
2. **`apps/mac/project.yml` (XcodeGen).**
   - App target `SVKILotse`: menu-bar agent app (`LSUIElement`), macOS deployment target 14.2,
     hardened runtime;
   - entitlements: audio input, outgoing network;
   - Info.plist usage descriptions: microphone, speech recognition;
   - Sparkle through Swift Package Manager, as in Clicky;
   - bundle id from a build setting (default `dev.svkilotse.mac`);
   - a scheme `SVKILotse` with unit tests.
3. **Swift package `apps/mac/Packages/LotseKit`** (swift-tools-version 6.0, Swift 6 language mode).
   - Library targets: `LotseCore`, `LotseBridge`, `LotseOverlay`, `LotseVoice`, `LotseCapture`,
     `LotseResolver`, `LotseImport`, `LotseGuidedWindow`, `LotseRelatives`. Each has a test target and
     at least one real type. Empty marker files are not allowed; a target can start with its public
     interface (protocol plus a minimal implementation) that later WPs extend.
   - Depends on the local package `../../../../packages/protocol/swift` (`LotseProtocol`), relative to
     `apps/mac/Packages/LotseKit`.
4. **Move Clicky code into modules** where the boundary is clean:
   - overlay window → `LotseOverlay`;
   - global push-to-talk monitor → `LotseVoice`;
   - screen capture utility → `LotseCapture`;
   - analytics → `LotseCore`: PostHog host from configuration, opt-in, off by default (PRD §15).

   Clicky code that stays in the app target may keep Swift 5 language mode. Document the migration
   plan in `apps/mac/AGENTS.md`.
5. **Remove:**
   - the Cloudflare Worker integration;
   - the AssemblyAI provider and its key handling;
   - Anthropic-specific chat code and the native conversation loop;
   - the `[POINT:…]` text-tag parser;
   - the US PostHog default host.

   Keep everything that still compiles and is reused: overlay, cursor animation, bubble, push-to-talk,
   capture, Apple Speech provider, Sparkle.
6. **Workspace window and bridge** (`LotseBridge`):
   - `WorkspaceWindowController` owns a `WKWebView`:
     - its own `WKWebViewConfiguration` and a persistent `WKWebsiteDataStore(forIdentifier:)`;
     - `preferences.inactiveSchedulingPolicy = .none`;
     - loads `LOTSE_WORKSPACE_URL` from Info.plist or the environment (default `http://localhost:3000`);
     - the window is hidden, never closed.
   - A `WKScriptMessageHandlerWithReply` named `lotse` is registered only for the workspace origin. It
     validates `frameInfo.securityOrigin` and the main frame on every message, decodes with the
     `LotseProtocol` types and replies.
   - `send(_:)` delivers `BridgeToWorkspace` envelopes to the page with
     `callAsyncJavaScript("window.__lotse.receive(message)", arguments:in:contentWorld:)` in the page
     content world. Inbound `BridgeToNative` envelopes arrive through the message handler.
   - `BridgeHello` is sent after the workspace finishes loading.
7. **Tests.**
   - `LotseBridgeTests` loads a test HTML page bundled as a test resource that echoes envelopes. It
     verifies:
     - the round trip of `BridgeHello` and `Transcript`;
     - rejection of an invalid envelope;
     - rejection of messages from a non-workspace origin;
     - `inactiveSchedulingPolicy` is `.none`.
   - Unit tests in the other modules cover the moved Clicky logic where it is testable.
8. **Lint and docs.** `apps/mac/.swiftlint.yml`.
   - `apps/mac/AGENTS.md`: module map, the invariants from PRD §17 (no provider key, overlay
     click-through outside draw mode, guided windows never get a message handler, generated protocol
     types never edited, no conversation logic and no call to `/api/turn`, no fact store), and the
     commands.
   - `apps/mac/README.md`: run instructions.

## Acceptance criteria

- [ ] AC1: `xcodegen generate` and `xcodebuild … build test` succeed without signing.
- [ ] AC2: `swift test` for LotseKit passes, including the bridge tests.
- [ ] AC3: No references remain to AssemblyAI, the Cloudflare worker, the Anthropic API or the US
  PostHog host (a test or gate script greps the sources).
- [ ] AC4: The app launches as a menu-bar app, shows the Clicky overlay and opens the workspace window.
  Record this as `not_run` with the reason if your sandbox cannot launch UI; the owner checks it at M0.

## Notes for the implementer

- Use `-derivedDataPath .build/dd` so build products stay in the worktree.
- If Swift 6 strict concurrency makes moved Clicky code noisy, isolate it with `@MainActor` and clear
  module boundaries rather than `@unchecked Sendable`.

## Suggested commits

- `chore(mac): import clicky sources under the mit license`
- `build(mac): generate the xcode project with xcodegen and add lotsekit`
- `refactor(mac): move overlay, capture and push-to-talk into lotsekit`
- `refactor(mac): remove worker proxy, assemblyai and anthropic chat`
- `feat(bridge): add workspace window with origin-restricted typed bridge`
- `test(bridge): cover round trip, validation and origin checks`
