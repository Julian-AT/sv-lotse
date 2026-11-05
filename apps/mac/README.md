# SV KI-Lotse for macOS

Clicky-derived Dock app with a menu-bar item for the web workspace. Requires macOS 14.2 or later,
Xcode with Swift 6, XcodeGen and SwiftLint. Upstream provenance and license are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

From the repository root:

```sh
cd apps/mac
xcodegen generate
open SVKILotse.xcodeproj
```

Install into `/Applications` (Release build, ad-hoc signed, registered with Launch Services):
`apps/mac/Scripts/install.sh`; then open “SV KI-Lotse” from the Dock, Launchpad or Spotlight.

Select the `SVKILotse` scheme and run. Start the web workspace separately at
`http://localhost:3000`. The app shows a Dock icon, a menu-bar item, the companion cursor in
SV brand green and the dashboard window, which embeds the workspace. Closing the
dashboard keeps the app running; the Dock icon, Command–0 or “Dashboard öffnen” in
the menu shows it again. Quit with Command–Q or from the menu.

Override `LOTSE_WORKSPACE_URL` in the launch environment or as an Xcode build
setting (written to Info.plist). The environment takes precedence. Only the exact
configured origin may use the native bridge. Authentication cookies persist in
the workspace's dedicated WebKit data store.

On first launch a branded guided setup window walks through microphone, Apple Speech,
screen recording, accessibility, input monitoring and notifications. Each permission has
its own reason, live verified/missing status, explicit Fix action and System Settings
link. Visible setup and settings windows recheck permissions automatically every two
seconds without capturing screens, starting microphones or prompting. Fix alone requests
access. Some grants require an app restart before macOS preflight reports them.

After the permission steps, setup checks a successful HTTP response from the configured
workspace, creates/verifies its anonymous session through `/api/session`, checks the
HttpOnly cookie in the persistent WebKit store, and verifies that BridgeHello delivery
has been acknowledged. It then requests and validates both Scribe and TTS tokens through
the authenticated workspace route. Provider failure uses the existing Apple fallback;
setup verifies on-device recognition availability and an installed system voice before
marking that fallback ready. Tokens stay in memory and are never logged or persisted.
Successful provider checks are cached for that setup run and language; retries and
navigation invalidate them. Network failures automatically retry at ten-second intervals.

Only verified steps (including an available Apple fallback) enable “Einrichtung
abschließen”. Completion persists separately from the older onboarding-review flag.
“Vorerst im Arbeitsbereich tippen” keeps setup incomplete and opens the workspace without
grants. Re-run the guide from “Einrichtung prüfen” in the menu-bar menu or Settings.
“Einstellungen…” (Command–comma) opens the native Settings scene. Settings also retains
language, local voice preview and shortcut opt-in.
Liquid Glass is used on macOS 26; earlier systems and Reduce Transparency use a material
fallback. The guide supports keyboard navigation and VoiceOver labels.

Focused setup checks:

```sh
swift test --disable-sandbox --package-path apps/mac/Packages/LotseKit --filter 'LotseCoreTests[.](GuidedSetupTests|CompanionOnboardingTests)/'
```

The status item uses a monochrome SV template icon and a standard NSMenu: status,
dashboard/new chat, settings/setup/feedback/about, help, pause/restart/quit. “Zuhören
fortsetzen” enables the global shortcut (default: Control–Shift–Space); hold to
record and release to send. Settings → Sprache & Stimme configures the shortcut
and speech speed. Settings → Assistent contains pointer and accessibility preferences.
This opt-in persists and restarts the listener only when Input Monitoring is
already granted. Disabling it cancels audio without sending. Microphone permission
is requested on first use if not enabled in setup. The local sample voice is
separate from the response voice configured in the web workspace.

For dictation into another app, enable the same voice shortcuts and grant Accessibility
in setup. Focus an editable field, hold **Control–Shift–D**, speak, then release to
insert the voice provider's formatted transcript. This second shortcut is independent
of the conversation shortcut and never sends a bridge transcript or conversation turn.
Dictation uses the existing on-device Apple Speech provider, with punctuation enabled;
it does not add a separate rewriting model or domain spelling dictionary.

Insertion first replaces the selected text through Accessibility (an empty selection
inserts at the caret). Editors without that setter use a Command–V event addressed to
the captured process. The previous clipboard items and all their materialized formats
are restored after the editor has time to consume the paste; a newer clipboard copy is
preserved. Keep the original field and caret focused until insertion finishes. Changed
focus/selection, password fields and unavailable permissions fail without sending text
to the conversation. Cancelling a hold, disabling voice, or interrupting the event tap
discards unfinished dictation. Microphone ownership is exclusive between both shortcuts.

The frozen bridge has no active-case, subject or autonomy-state message. The dashboard
therefore retains the workspace for these values; it never guesses or
stores conversation state locally. Screen capture remains explicit-request only;
outside setup, screen capture permission is requested only when a final push-to-talk
question or an explicit screen-target action needs OCR or vision.

Scribe realtime is the default, using a single-use token from
`POST /api/voice/token`. Apple Speech requests its separate permission only when
the local fallback is needed. Install on-device recognition for your selected
language for that fallback. Provider API keys stay on the server. Token requests
execute in the trusted workspace with its existing HttpOnly session cookie.

Workspace `SpeechSegment`s play through ElevenLabs PCM streaming on one
multi-context WebSocket per turn. Each sentence has its own flushed context;
interrupted/expired sockets get a fresh-token retry, then AVSpeechSynthesizer
handles provider unavailability. The Sprache & Stimme settings pane persists 0.5×–1.5× speed.
The hotkey immediately stops and clears queued speech, reports `SpeechControl`
to the workspace, and drops late segments from the interrupted turn. Sentence
actions run when playback starts, including actions arriving just after that
boundary. `onSentenceAction` connects additional native target resolvers.

Every final transcript includes a `ContextCapsule` with real foreground workspace
page handles when available, alongside the screen context described below.
`captureVoiceContext` lets another screen/guide capability supply its capsule in
place of the default screen capture; missing page context still falls back to the
workspace. Unavailable surfaces have absent fields.

The server requires `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID_DE` (plus
`ELEVENLABS_VOICE_ID_EN` for English). Optional `ELEVENLABS_TTS_MODEL` defaults to
`eleven_flash_v2_5`. Token requests accept `{type: "realtime_scribe" | "tts_websocket",
language: "de" | "en"}`; omitted values default to German Scribe. Responses are
private/no-store and token creation is limited per authenticated session.

Voice checks from the repository root:

```sh
swift test --disable-sandbox --package-path apps/mac/Packages/LotseKit --filter LotseVoiceTests
bun run --filter @lotse/brain test -- test/voice
bun run --filter @lotse/web test -- test/voice-token.test.ts
RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/voice
```

The live test obtains real single-use credentials, generates two sentences over
one TTS socket and transcribes their PCM with raw Scribe WebSocket messages. It
requires a valid voice available to the configured account and makes paid API
calls. Full Mac tests additionally need a GUI session and TCC permissions.

By default, each final push-to-talk transcript triggers one ScreenCaptureKit capture of all
displays and on-device Vision OCR, and carries the resulting `ContextCapsule` to the
workspace. Partials, launch and permission rechecks never capture. Grant Screen
Recording in setup or at the first explicit capture request; if capture fails, the
question still arrives without screen context and the companion shows a notice.
Screenshots and OCR are held in memory only.

Choose “Bereich einkreisen und fragen” in Settings → Assistent to select a region on any display.
Draw a circle or scribble, release, then ask with push-to-talk. The selection belongs
to exactly the next final transcript. Mouse-up, Escape, right-click, “Zeichenmodus
beenden”, hiding the overlay and display changes restore click-through. The overlay
never becomes the key window. Display changes clear a pending selection rather than
reusing stale geometry.

The frozen v1 capsule has one `screen`. Its index and normalized, top-left OCR boxes
refer to the cursor display, or the circled display when selected. Labeled OCR text
from every other display is retained in `screen.summary`. `focusedRegion` is normalized
against the selected display, including monitors with negative global origins. The
bridge has no image-file transfer envelope, so `screen.image` remains absent rather
than advertising an unattached image. No protocol schema change is required.

Sensitive applications and the companion itself are excluded by ScreenCaptureKit
application filters, without window exceptions. The sourced policy lives in
`packages/knowledge/privacy/screen-capture-exclusions.json`; regenerate its bundled
SwiftPM resource after editing it:

```sh
bash apps/mac/Scripts/generate-capture-policy.sh
```

Extend the native bundle-identifier exclusions through the
`screenCaptureExcludedBundleIdentifiers` UserDefaults string array. Add the entire
browser if it is used for sensitive banking pages: native application filtering
cannot identify banking tabs or password-manager browser extensions. Bundled defaults
cannot be removed by an empty user setting. A missing or malformed bundled policy
blocks capture.

Document import (FR-D1, NFR-3): click the paperclip in the dashboard toolbar and choose a
file, or drop a PDF/image on the dashboard window. Native drops work
even when the web workspace cannot load. The native panel previews each document;
only “Speichern und hochladen” persists it. Imports explicitly target your own
context, since the frozen bridge does not expose the active subject. Individual
facts still require confirmation in the workspace. Accepted uploads are PDF, PNG
and JPEG, up to 20 MB; other readable image formats are converted to PNG locally.

For an iPhone photo or scan, right-click in the native import surface or workspace
and use macOS's Continuity Camera menu. The responder implements
`NSServicesMenuRequestor` and routes PDF/TIFF/PNG service data through the same
preview. Device availability, Bluetooth/Wi-Fi and Apple account requirements are
managed by macOS. For a multi-page screen document, select a display, click
“Nächste Seite aufnehmen”, scroll the source document yourself and repeat. Each
click captures exactly one page on that display, excluding the app itself and
the configured sensitive applications. Finish with “Seiten als PDF übernehmen”,
review the ordered PDF, then confirm the upload. There is no timer or automatic
scroll/capture. Up to 50 pages and 20 MB are accepted per captured document.

The Application Support upload queue contains AES-256-GCM ciphertext, including
filenames and session metadata. Its non-synchronizing, device-only Keychain key
is available only while unlocked. Queue files have mode 0600, the directory 0700,
and backups are excluded. No plaintext staging files are written. Confirmed
documents remain queued across restarts and outages; a 30-second retry loop sends
them to `/api/documents`. The menu and import panel show degraded status. Only a
successful response containing the matching upload UUID and a document UUID
authorizes deletion. Retries reuse the same UUID; the server serializes them and
stores a single document in Postgres and encrypted object storage.

Native uploads reuse the embedded workspace's signed httpOnly cookie. They use
HTTPS outside loopback, disable shared cookies/caches and reject redirects. A
queue item is bound to its workspace origin and stable session UUID, so cookie
signature rotation works without moving documents into another session. If the
session changed or was unavailable during initial import, open the queued-document
preview (“Vorschau vor dem Speichern”) and explicitly confirm it in the current
session, or discard it. Discarding a queue item never removes the original file.

The baseline capture exclusions are sourced from
`packages/knowledge/guards/mac-capture-exclusions.json`; the generated bundled
resource must be refreshed with `bash apps/mac/Scripts/generate-import-resources.sh`
after changes. Add installed banking or other sensitive applications through the
comma-separated launch variable `LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS`. Browser
windows are excluded by application, not by page contents: include the browser's
bundle ID when it displays banking or other sensitive pages. A missing/malformed
baseline disables capture.

The upload adapter stores documents with OCR status `pending`; extraction and fact
confirmation then run in the workspace (`/api/documents/:id/extract`).
Its envelope wrapping key is HKDF-derived from the validated server `SESSION_SECRET`
with a separate document-encryption context. Rotating that secret requires rewrapping
stored document keys first. This adapter adds no provider, secret or database schema.

Analytics is off by default. To use it, configure `POSTHOG_HOST` (HTTPS) and
`POSTHOG_PROJECT_TOKEN` in the app's environment, then enable “Nutzungsstatistik
erlauben” in Settings → Datenschutz. There is no built-in analytics host or token. Disabling
consent stops the SDK. Events carry no transcript, document or form content.

Sparkle is linked through SPM. Release builds supply `SUFeedURL` and `SUPublicEDKey`
through `project.yml`, and sign updates with the release key outside the app.
Automatic update checks are disabled in this development configuration.

Relatives sharing uses LiveKit Swift SDK 2.19.0. Open “Angehörige: Bildschirm teilen …”
in Settings → Helfer, choose a case and display, and explicitly approve screen and microphone sharing.
The floating window remains the visible indicator and stop control. Closing it pauses sharing.
Consent expires after 15 minutes and is also revoked on sleep, lock, display changes, application
launch, transport loss or a room recording indicator. The app never records the session.
Configure `LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS` as a comma-separated list of sensitive application
bundle identifiers in the Mac launch environment. This app is always excluded too; its embedded
workspace therefore does not appear in the display stream. New application launches stop sharing
so a newly opened sensitive app cannot escape the existing filter.

On the web server, configure all three `LIVEKIT_URL` (`wss://`, or `ws://` on loopback),
`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. The native app holds no provider key. It fetches
`POST /api/relatives/token` within the authenticated workspace with
`{ "caseId": "<uuid>", "consent": true }`. The response contains `serverUrl`,
`participantToken` and an ISO `expiresAt`. The route derives subject/helper grants from persisted
case ownership and membership. A helper can optionally supply `displayName` for its signed cursor
label. Invite/join approval belongs to the helper web flow; this module does not grant case access.

Helper clients publish JSON on LiveKit topic `lotse.relatives.pointer.v1`, using monotonically
increasing `sequence` numbers per connection. Coordinates are normalized to the shared video's
content, measured from its top-left corner, excluding letterboxing:

```json
{"kind":"cursor","sequence":1,"x":0.25,"y":0.75}
{"kind":"annotation","sequence":2,"points":[{"x":0.2,"y":0.7},{"x":0.3,"y":0.8}]}
{"kind":"clear","sequence":3}
```

Only server-issued `helper:` identities are accepted. Events never move the real mouse or approve
actions. The second cursor is light green with the signed participant name; the pilot cursor stays
SV brand green.
The receiver rejects invalid, oversized or stale events, bounds annotations, maps to the selected
display, and clears helper marks when the session ends.

Unsigned build and tests, from the repository root:

```sh
bash apps/mac/Scripts/generate-import-resources.sh
swift test --package-path apps/mac/Packages/LotseKit
xcodebuild -project apps/mac/SVKILotse.xcodeproj -scheme SVKILotse -destination 'platform=macOS' -derivedDataPath .build/dd CODE_SIGNING_ALLOWED=NO build test
swiftlint lint --strict --config apps/mac/.swiftlint.yml apps/mac/Packages
bash apps/mac/Scripts/check-source-boundaries.sh
```

The package tests include real WebKit/HTTP integration tests; run them in a logged-in
macOS GUI session. `SVKILotseTests` in the app scheme checks its bundled launch and
permission configuration.

Overlay actions use the generated protocol. Send `TargetRect` immediately before each workspace
`point`, `highlight`, `annotate` or `type` action. The preferred `targetId` is the action id;
UI element ids and form field ids are also accepted, with `formInstanceId:fieldId` available
for disambiguation. Rectangles are top-left web-view points (not pixels); `scale` must not be
applied again. Invisible, clipped and stale rectangles fail instead of pointing at old content.
The viewport is converted through the current workspace window, including on secondary displays.
Workspace navigation cancels pending resolutions and clears cached rectangles.

Native `type` actions only move the overlay; the workspace performs its approved draft typing.
`SpeechSegment` supplies the full caption and sentence index, and `SpeechControl` announces
playback/stop. Actions are prepared asynchronously and future-sentence actions wait for their
sentence. Send `clear` at step completion or user action; idle/stop clears immediately and an
8-second fallback clears orphaned steps. Styles are `arrow`, `circle`, `rectangle`, `numbered`
and `highlight`; numbered markers use the one-based sentence index. Flights use the global
AppKit desktop and take at most 480 ms, with reduced-motion support.

For external app OCR and the vision fallback, set `LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS` in the
Mac process environment to the deployment's comma-separated password-manager and banking app
bundle identifiers. Missing or invalid policy disables external screenshots; workspace and AX
pointing continue to work. This policy is deployment data, never a hardcoded allowlist in Swift.
Capture excludes those applications and the companion itself, is explicit-request-only, and
reuses in-memory captures for up to 15 seconds and never persists them. OCR uses Apple Vision accurate German
and English recognition; duplicate quotes are refused. AX resolution is read-only and needs
Accessibility permission already enabled in System Settings; it never prompts at launch.

The native resolver calls `/api/resolve` through same-origin fetch in the existing workspace,
so its session stays in WebKit's cookie store. The route requires a session and checks origin,
limits request/image size and accepts only inline JPEGs. The brain's `vision` model role
(`OPENAI_MODEL_VISION` and optional fallback override) returns a normalized point only at
confidence 0.8 or higher; uncertain/missing targets return failure. No provider key or model
request lives in the Mac app. A vision resolution can exceed the flight budget; prepare
sentence actions before playback to keep NFR-2's resolved-target budget.

Focused dictation checks: `swift test --disable-sandbox --package-path apps/mac/Packages/LotseKit --filter LotseVoiceTests`.
Clipboard ownership tests use a test-only clipboard adapter because sandboxed test
processes may not reach the pasteboard daemon. On a logged-in Mac, manually check a
TextEdit field, a browser textarea, selected-text replacement, focus changes during
recognition, and clipboard preservation (including rich text and a newer copy).

Guided portal windows use their own ephemeral WebKit configuration, without a native
message handler. DOM `openResource` actions use `target.url`; subsequent DOM actions
run in an isolated content world and return protocol `ActionResult` messages.
Final push-to-talk transcripts include the active portal's credential-filtered page
capsule. Each typing or clearing group requires native approval before its first
change. Closing or navigating the window cancels typing and clears its overlays.

Regenerate the shipped guide and allowlist after changing `packages/guide`
or `packages/knowledge/allowlist.yaml`:

```sh
node apps/mac/Scripts/bundle-guide.mjs
```

The script bundles the real guide with esbuild, checks its 512 KiB uncompressed limit,
and writes a compressed SwiftPM resource plus the sourced allowlist. These generated
resources ship with the module; a repository checkout is not needed at runtime.
Foreign navigation, iframe navigation and download redirects are denied by the same
exact-origin policy. Allowlisted popups stay in the guided window.

`WKDownloadDelegate` writes each download to a private temporary directory, then
`LotseImport.EncryptedUploadQueue` encrypts the original and metadata with AES-GCM
and deletes the temporary plaintext. Its production key lives in the Keychain.
An upload worker can use `shell.guidedPortal.uploadQueue`, read pending entries,
and call `acknowledgeUpload` after `/api/documents` confirms receipt. Upload transport
is outside this module; entries persist across launches until acknowledgement.
Files are never opened or executed. The download handler exposes `onFailure` and
`onQueued` callbacks.

The guided runtime regression loads real HTML in WebKit and checks world isolation,
credential filtering, DOM highlighting and termination handling. It needs a logged-in
GUI session with WebKit helper processes available. Sandbox extension denials produce
an explicit timeout failure. Queue tests use ephemeral test keys and real encrypted
files, without accessing the production Keychain.

### Spoken source highlights

`SourceHighlightCoordinator` resolves text targets with local Vision OCR and prepares exact
substring boxes before queuing the shared native speech controller (ElevenLabs with on-device
fallback). Playback start events
apply the boxes immediately, then send `SpeechControl` over the existing bridge. Stream arrival
never fires a highlight. Source actions use the same sentence clock as other native actions. Explicit clear actions remove
the source marks. Stop/barge-in
cancels pending work and audio while retaining the current highlight until the next step.

Capture runs only for an explicit text action and an existing screen-recording grant; it never
prompts, polls, or transmits images. Capture exclusions are sourced from
`packages/knowledge/guards/capture-exclusions.json` and bundled by
`node apps/mac/Scripts/sync-capture-policy.mjs`. Regenerate the bundle after changing that policy.
Additional sensitive application bundle identifiers (including the user's banking apps) can be
configured under the `captureExcludedBundleIdentifiers` UserDefaults array. Missing policy fails
closed. The existing capture filter always excludes this app. Vision bottom-left normalized boxes
are mapped through each display's AppKit frame, including secondary displays and Retina scaling.
An absent or ambiguous quote returns an unsuccessful `ActionResult`; it never guesses a position.

The focused headless tests are `swift test --disable-sandbox --package-path
apps/mac/Packages/LotseKit --filter 'quoteAcrossOCRLines|quoteRejectsAmbiguity|quoteDisplayCoordinates|sourceActionsWaitForPlayback'`.
The full bridge/overlay suite still requires a GUI session and a real screen.

## Native dashboard and settings

The dashboard hosts a `NavigationSplitView` around the existing persistent WebKit
workspace. It uses system sidebar vibrancy, with macOS 26 Liquid Glass and a material
fallback for older systems and accessibility preferences. Search and calendar-day
groups operate on cases read from `GET /api/cases?view=dashboard`, refreshed every
20 seconds and on connection/activation. Selection navigates the same WebView to
`/workspace?caseId=<uuid>`; transcripts, approvals and history still use its sole
conversation client. The embedded page hides duplicate browser navigation.

Context-menu rename stores presentation metadata in `journey_map.dashboardTitle`
without confirming or changing a goal. Delete asks for confirmation, rejects a
running turn, deletes case-owned history and prepared form outputs, and keeps
subject-level documents shared by other cases. Both routes use the authenticated
WebKit session, same-origin protection and brain authorization. No local case store
or provider credentials are introduced.

The native Settings scene has six toolbar tabs: Allgemein, Sprache & Stimme,
Assistent, Datenschutz, Helfer and Verbindungen. Language, simple language, register
and detail level save immediately through `/api/profile`; capability preferences
remain local. Failed profile saves stay visible and can be retried. Permission and
health status rows reflect actual OS checks and `/api/health`, refreshed while the
settings window is open. Checks do not request permissions or capture the screen.
Feedback opens the repository issue page without sending data automatically.

Focused checks (the complete Mac suite still requires a GUI session):

```sh
swift build --disable-sandbox --package-path apps/mac/Packages/LotseKit
swift test --disable-sandbox --package-path apps/mac/Packages/LotseKit --filter LotseCoreTests
bunx vitest run packages/brain/test/case-file/dashboard.db.test.ts
bun run --filter @lotse/web test -- test/cases-route.test.ts test/initial-case.test.ts test/speech-runtime.test.ts
```

### Voice vocabulary

Scribe uses the current profile language and vocabulary from the authenticated voice-token
response. Apple Speech recognition and dictation use a bundled copy of the same sourced
knowledge data, so hints and spelling normalization also work offline. Regenerate it with
`bash apps/mac/Scripts/generate-voice-vocabulary.sh` from the repository root after editing
`packages/knowledge/data/voice-vocabulary.json`; never edit the resource copy by hand.
TTS applies the response's language-specific pronunciation aliases only to synthesis input;
workspace captions retain their original text.
