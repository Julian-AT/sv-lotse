# Mac capability provider

Scope: `apps/mac/**`. Read the repository rules and the assigned WP before editing.
Other apps, protocol sources, generated protocol types and challenge data are read-only.

## Module map

All new capability and UI code belongs in `Packages/LotseKit` (Swift 6, tools 6.0).
`App/SVKILotseApp.swift` is the thin Clicky-derived SwiftUI lifecycle and Sparkle adapter.
Its Swift 5 language mode is temporary: migrate it after the updater API and app lifecycle
are checked with strict concurrency; do not solve warnings with unchecked sendability.

| Module            | Responsibility                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| LotseCore         | Shell composition, menu bar, opt-in configured analytics                                          |
| LotseBridge       | Persistent workspace window, origin policy, typed bidirectional WebKit bridge                     |
| LotseOverlay      | Click-through per-display windows, cursor flight and caption bubble                               |
| LotseVoice        | Listen-only global shortcut monitor, configurable shortcut state, on-device Apple Speech fallback |
| LotseCapture      | Explicit-request ScreenCaptureKit JPEG capture with caller-supplied sensitive-app exclusions      |
| LotseResolver     | Display coordinate conversion; AX/OCR resolution is extended by later WPs                         |
| LotseImport       | Readable local document boundary; encrypted upload queue is added by later WPs                    |
| LotseGuidedWindow | Exact-origin policy and a separate, handler-free, ephemeral configuration                         |
| LotseRelatives    | Expiring, revocable screen-sharing consent; no transport or recording                             |

Each module has its own test target. Bridge integration tests load the bundled HTML fixture
over real loopback HTTP in WebKit. They require a macOS GUI session and local listening access.

## Invariants

- No provider key or provider credential handling in the Mac app.
- No conversation logic, no call to `/api/turn`, and no local fact store.
  The embedded workspace is the only conversation client.
- The overlay is click-through outside explicit draw mode and never takes keyboard focus.
- Guided windows never get a message handler. Their data store, configuration, content
  controller and eventual isolated guide content world must remain separate from the workspace.
- Generated `LotseProtocol` types under `packages/protocol/swift` are consumed, never edited.
- The persistent workspace uses a stable data-store UUID, exact scheme/host/port checks,
  main-frame-only messages and generated envelope decoding. JavaScript values are passed
  through `arguments`, never interpolated. Close requests hide the workspace.
- Keep inactive scheduling `.none`, including when the workspace is hidden.
- No capture at launch or on a timer. Capture requires an explicit request and the configured
  password-manager/banking exclusion list. Display indices remain stable within one capture.
  ScreenCaptureKit filters exclude running applications by bundle identifier, always including
  this app (and its process even without a bundle identifier), with no window exceptions.
  Never use an enumerated window snapshot for sensitive-app exclusions.
- Permission prompts occur only after a user enables a capability or presses the hotkey.
- Start/stop the event tap on the main actor; its owner must stop it before release. Do not
  move its callbacks off the main run loop. Cancel speech and release the microphone on stop.
- The default shortcut is Control-Shift-Space: an explicit key avoids modifier-only prefixes,
  Control-Option is reserved by VoiceOver, and Caps Lock may also be its modifier. Never start
  recording for either VoiceOver modifier. Menu-bar shortcut choices persist in UserDefaults
  under `pushToTalkShortcut`; changing the choice cancels the current hold without sending.
  Adding a disallowed modifier cancels the hold; only a non-repeat key-down starts a new hold.
- A recognizer final while held stops audio input and retains text as a partial. Only release
  requests a final transcript; cancel discards retained text.
- BridgeHello waits at most five seconds for the page receiver after a navigation finishes.
  Polling is cancelled on navigation/failure/process termination; stale completions cannot set
  readiness. Refuse outbound messages until hello succeeds. Decode inbound envelopes through
  generated `decodeValidated`, including schema constraints, before dispatching capabilities.
- Push-to-talk owns a synchronous hold UUID. Release invalidates it and cancels pending start
  work; check cancellation and the hold after each permission await before starting capture.
  Released recognition sessions finalize independently of later holds, delivering at most one
  final transcript per utterance before cleanup. Stop cancels all sessions and pending starts.
- Analytics defaults off, needs explicit consent and configured HTTPS host/project token,
  and accepts no user content. No session replay in workspace or portal windows.
- Signed release builds must configure Sparkle's feed and public verification key. Do not
  put a signing private key in the bundle. Development builds leave updates unconfigured.
- `project.yml` is the source for generated plists and the ignored Xcode project; regenerate
  them rather than editing them. Resolve package lockfiles with SwiftPM, never by hand.

## Commands

Run from the repository root unless shown otherwise:

```sh
cd apps/mac && xcodegen generate
swift test --package-path apps/mac/Packages/LotseKit
xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
swiftlint lint --strict --config apps/mac/.swiftlint.yml apps/mac/Packages
bash apps/mac/Scripts/check-source-boundaries.sh
```

The `cd` line runs in its own shell; the remaining commands run at the repository root.
For a sandbox that rejects nested `sandbox-exec`, diagnostic compilation can use
`swift test --disable-sandbox --package-path apps/mac/Packages/LotseKit`, with
`CLANG_MODULE_CACHE_PATH` set to a writable cache. This does not replace the required
unsandboxed owner gates. Never skip the WebKit tests to claim a passing suite.

Keep the protocol round-trip and bridge isolation checks green (PRD §9, §13, NFR-10/11).
The owner checks menu bar, overlay, workspace, VoiceOver and permission behavior at M0.
