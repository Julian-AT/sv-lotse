# Web workspace

Run commands from the repository root with Node 22 on `PATH`. Bun runs the package scripts.

## Workspace pages

Routes: `/cases`, `/journey`, `/documents`, `/offers`, `/appointments`. The home page links to
the workspace. Pages support German and English, the existing language cookie and keyboard use.

The session-protected `/api/workspace` endpoint reads real Postgres context through
`@lotse/brain/workspace`. `caseId` selects an owned case; `benefitId` selects a catalog checklist.
The selected benefit follows navigation into appointment preparation. The owner workspace does
not expose restricted helper context. No user context is stored in browser storage.

JourneyMap projects persisted case steps and assistant case events, including responsibility,
prepared artefacts, blocked steps and due dates. Pages refresh every 15 seconds and on focus.
Document possession uses an exact match of the stored document type and the catalog document ID
or official title. It never infers possession from a medical fact. Ambiguous process matches ask
the user to select the benefit rather than choosing an arbitrary checklist.

The MapLibre map uses OpenStreetMap raster tiles without an API key, after the user loads it.
Location access is optional and user initiated. Distances are straight-line distances; unavailable
coordinates and hours are explicitly unknown. Facilities without coordinates remain in the list.

`/api/appointments/prepare` generates editable call and email drafts from the current case and
sourced contact channels. `/api/appointments/calendar` downloads a tentative RFC 5545 hold for
the user's chosen times. Neither endpoint books, submits, sends email or writes to a calendar.
No verified booking form is present in the initial facility records; preparation ends with drafts
and a calendar hold. The pilot does not invent availability or form fields.

## Run and verify

Use Node 22+ on PATH, Bun for scripts and the real Postgres/MinIO services described in the root README.

### Control audit

`bun run --filter @lotse/web test:controls` creates and migrates an isolated Postgres database,
loads the sourced knowledge catalog, starts the development server on port 3043 (override with
`LOTSE_CONTROLS_PORT`), and runs the
screen-specific Playwright tests in `e2e/controls/`. The database is dropped after the run.
MinIO objects created by the browser fixtures are deleted by their tests. Existing shared data
and the shared catalog are not modified.

The audit uses Webpack and polling because the macOS sandbox cannot start Turbopack's FSEvents
watcher. It warms the routes before testing and uses `.next/controls` for its build output, so
it can run alongside the normal development server. Set
`PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3002/` to use the existing matching
Playwright browser server; loopback networking is forwarded automatically. Alternatively install
the matching local Chromium. Keep Node 22+ ahead of other Node installations on PATH.

The full suite calls the real configured model for extraction and conversational turns. Provider
quota or availability failures fail those tests; there is no simulated response or automatic skip.
Approval fixtures are test-only, signed administrative state and use the real brain, Postgres,
HMAC verification and form persistence. Form approvals execute their authorized work before a new
classifier or embedding request, so a provider outage cannot prevent that confirmed work.

Failure traces and the route control inventory are written under `test-results/controls/`.
Load the catalog with `bun run --filter @lotse/knowledge catalog:load` before using catalog pages.
This task adds two sourced facility records (FSW Guglgasse and AUVA Meidling), awaiting human
review; broader directory coverage remains a data curation task. Do not run catalog loading
against another agent's disposable database or overwrite its data.

```sh
bun run typecheck
bun run --filter @lotse/web test
bunx vitest run packages/brain/test/workspace --hookTimeout=30000 --testTimeout=15000
bun run --filter @lotse/web build
PW_TEST_PORT=3418 bun run --filter @lotse/web test:workspace
```

`test:workspace` creates, migrates and drops a disposable real Postgres database, then drives all
five production pages with Playwright. It tests checklist continuity, live case-step changes,
map markers, editable drafts, calendar download, access denial, WCAG 2.2 AA and a narrow viewport.
It requires a free test port, a built standalone server, a browser and database CREATEDB rights.
For a matching remote browser in a sandbox, set `PW_TEST_CONNECT_WS_ENDPOINT` and optionally
`PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>'`. The default test port remains 3000.

## Integration deviations

- Added the small public brain workspace service and HTTP adapters because the corresponding
  conversation tool groups were not yet implemented. Pages do not call placeholder tools.
- Added optional `opening_hours` text to the knowledge facility schema; no database migration or
  frozen protocol/tool schema changed.
- Added configurable Playwright ports and remote browser support for parallel sandbox runs.
- No automatic booking prefill is claimed without a verified booking page and approved values.

Verification on 2026-11-06: monorepo typecheck, production build and client-secret scan passed;
39 web unit tests, 12 workspace brain tests (including real Postgres), 128 relevant knowledge
tests and the production browser flow passed. The broader knowledge suite hit its existing
five-second SozDok corpus timeout. Fresh Compose startup could not allocate a network because
Docker address pools were exhausted; existing real services were used. Local Chromium was
blocked by macOS sandbox permissions; the matching remote Playwright browser passed.

## Browser voice

`VoiceWorkspace` connects push-to-talk to the existing `/api/turn` UI message stream.
`VoiceControls` and `useBrowserVoice` can also be integrated into another conversation host:
send final `onTranscript` text as a user message with `inputKind: "transcript"`, forward stream
data parts to `receive`, and execute `onAction` callbacks through the existing guide/bridge.
Call `beginTurn` when sending a new message. Call `stop` on interruption and `unlock` from the
user gesture that starts a turn. The hook releases all microphone, socket and audio resources
on unmount. Nothing is stored in browser storage.

### Configuration

Set `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_DE` and `ELEVENLABS_VOICE_ID_EN` on the server.
Voice IDs must identify voices available to that account. Missing configuration, provider
failures and unsupported audio fall back to Web Speech when the browser supports it; text
input and streamed answer text remain available. Web Speech recognition uses the UI language;
Scribe detects the spoken language automatically. Microphone access requires HTTPS or localhost.

`POST /api/voice/token` requires the normal session cookie and a same-origin request. Body:
`{ "type": "realtime_scribe" | "tts_websocket", "language": "de" | "en" }`.
The private, uncached response contains `{ token, expiresIn: 900 }`, plus `voiceId` for TTS.
Tokens are minted on demand, expire after 15 minutes, and are consumed by the provider on use.
The API key never reaches the browser. One multi-context TTS socket serves each turn;
sentences stream as PCM and actions fire when their audio begins, including Web Speech fallback.
The player accepts both documented snake_case and observed camelCase TTS frames.

Until the brain emits speech segments, completed text-only replies are divided into sentences
for playback after the stream finishes. Canonical `data-speech-segment` replies speak immediately
without waiting for the turn to finish. The minimal browser host executes display actions through
`@lotse/guide`; typing/clearing remain ghost previews, and no approval-gated client tools execute.

### Verification

Run from the repository root with Node 22 on `PATH`:

- `bun run typecheck`
- `bun run --filter @lotse/web test`
- `bun run --filter @lotse/web build` (includes the client secret scan)
- `bun run --filter @lotse/web e2e --grep @voice` (real session services; test-only browser/provider doubles)
- `node --experimental-strip-types apps/web/scripts/voice-smoke.ts` (real Scribe session and TTS audio)

The live smoke uses the configured German voice. `--discover-voice` selects an available account
voice for that invocation only to distinguish a voice configuration problem from a transport problem.
It never edits environment files or prints keys, voice IDs, tokens, audio or provider error bodies.

## Web observability

AI SDK telemetry is registered once by `src/instrumentation.ts`. `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` must both be present to install the exporter; neither is required for local
operation. `LANGFUSE_BASE_URL` selects the hosted or self-hosted instance. Before the processor sees
an ended span, content-bearing AI SDK/GenAI, tool, speech, schema, context and exception fields are
removed from attributes and events. Exception status messages are removed, runtime context and
headers are excluded, and media uploads are disabled. Safe operational metadata and usage remain.

PostHog uses the server-side Capture HTTP API at `POSTHOG_HOST`, enabled only with `POSTHOG_KEY` and
explicit consent in Settings (off by default). The key never enters the browser bundle. Saving the
consent preference updates the profile and the HttpOnly, SameSite consent cookie used by analytics;
the dedicated consent endpoint remains available. No analytics identity is persisted.
`turn_completed` is emitted from the authoritative runtime completion callback. Other feature owners
call `captureAnalytics({ event, properties })` from `src/analytics/client.ts` using the twenty-event
PRD taxonomy in `src/analytics/events.ts`. Pass only catalog/protocol ids, fixed categories, timings
and counts: identifiers must never be derived from user input. Events with unknown fields fail
validation at both boundaries. Unsupported language tags become `other`.

`POST /api/analytics` requires a real session, same-origin request, consent cookie and explicit
consent envelope. Payload size is bounded. The server forwards only validated properties, with
person profiles and geoip disabled, and never forwards browser headers, URLs or client IPs. No SDK,
autocapture or session replay is loaded. An ephemeral random id is used for explicit browser events;
server-completed turns use a fresh random event id. Exports time out and never fail a user action.

Checks:

```sh
bun run typecheck
bun run lint
bun run --filter @lotse/web test
bun run --filter @lotse/brain test:telemetry:integration
```

Privacy regressions exercise real SDK model/tool telemetry with test-only model doubles and an
in-memory exporter, including sensitive span events and speech fields. Live provider ingestion is
not required by these tests.

## Form viewer (FR-D5, FR-L4)

`/forms/<form-instance-id>` opens the session-authorized instance. The viewer renders the original
PDF with the installed pdf.js version, displays draft/confirmed overlays and source chips, and
provides a keyboard-accessible field list and correction editor. No user content is kept in browser
storage. Official template metadata supplies labels, owner restrictions, validation and positions.

The HTTP adapters are:

- `GET /api/forms/instances/:id`: template fields and persisted values/provenance.
- `PATCH /api/forms/instances/:id`: strictly `{ fieldId, value }`. The brain locks the instance,
  validates the field, saves a statement fact and resets that field to draft. It invalidates an
  existing generated PDF. It cannot confirm fields, change provenance or supply approval ids.
- `GET /api/forms/:id/pdf` and `/api/forms/instances/:id/pdf`: original PDF from object storage.
  These require the same session/case authority as the instance and return `private, no-store`.
- `/api/pdfjs/...`: allowlisted, version-matched public worker/CMap/font/WASM assets from the installed
  distribution. No remote CDN is used. Next standalone tracing includes these assets.

Case owners and persisted subject actors can use the viewer. Helper-only access is denied until
there is a projection that removes unshared provenance. All doctor, hospital, office and signature
fields remain read-only. A field without a fact-type mapping still saves a statement fact containing
the instance/field identity and correction; it does not invent a mapping to an existing fact type.

### Conversation client integration

Import the public feature entrypoint `src/features/form-viewer/index.ts`:

1. Mount `FormViewer` with `formInstanceId`, validated `actions`, an optional `approval`, and the
   workspace's `onActionResult`/`onApprovalDecision` callbacks. `approval` contains the actual
   `ApprovalContext`, `formInstanceId`, `fieldIds` and `values` from the pending `form.commitGroup`
   input. `onApprovalDecision` has the SDK `addToolApprovalResponse({ id, approved, reason? })` shape.
2. Increment `refreshVersion` when a persisted `form.prefill` or `form.commitGroup` tool result arrives.
   The card also refreshes after sending a decision, but never marks a field confirmed optimistically.
   A corrected value disables its old approval preview. A fresh server-issued approval is required.
3. The mounted `FormViewerWorkspace` host supports `dispatchFormAction(action)` (returns its real
   `ActionResult`), `presentFormGroupApproval(input, addToolApprovalResponse)` and
   `refreshFormViewer(instanceId)` for a surrounding conversation layout. Dispatch after the viewer
   mounts; a closed/wrong viewer returns failure. Replayed action ids return the previous outcome.
4. The normal workspace bridge should forward incoming messages to
   `receiveFormViewerBridgeMessage`. The standalone route installs `window.__lotse.receive` only
   when no receiver exists. It recognizes native stop and approval-decision messages. The default
   outgoing adapter posts protocol-validated `TargetRect` envelopes to
   `window.webkit.messageHandlers.lotse.postMessage`. A shared bridge can override `onTargetRect`.

`type` actions run sequentially, once per action id, at `payload.pace` milliseconds per grapheme.
The slower setting doubles that pace. Reduced motion displays the complete value immediately.
The in-page cursor, caption and provenance accompany the active field. Escape, Stop, keyboard editing
and native `SpeechControl.stop` cancel filling. UI animation changes only transient display;
`form.fillLive` owns server draft persistence. Approval execution remains in the brain.

Template boxes use displayed CropBox points, a top-left origin and one-based page numbers. AcroForm
widgets are transformed by the actual pdf.js viewport, including rotation. The bridge reports logical
window/CSS rectangles with device scale separately, updates after page render, scrolling and resize,
and invalidates rectangles on cleanup. It never multiplies coordinates by canvas pixel density.

### Verification

- `bun run typecheck`
- `bun run --filter @lotse/web test`
- `bun run --filter @lotse/web test:services -- test/form-viewer.db.test.ts`
- `bun run --filter @lotse/web build`
- `bun run --filter @lotse/web e2e -- --grep @form-viewer`

Service tests use a disposable real Postgres database and isolated MinIO object prefix. Browser
tests create and clean up a synthetic administrative AcroForm, case and instance in the configured
services; there are no mocked PDF or form routes. Unit tests use synthetic field/action fixtures
to isolate pacing, cancellation, owner restrictions, native message validation and approvals.

On sandboxed macOS, use the already-running matching Playwright server when local Chromium cannot
launch: `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3002/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>'`.

pdf.js rendering follows the [official display API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
Asset packaging uses Next's [standalone tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

## Development server

Run `bun run --filter @lotse/web dev` from the repository root. The app loads root
`.env.local`; copy the public defaults from `.env.example` for local services.

## Remote helpers (FR-R1–R5)

1. Run `docker compose up -d --wait` and `bun run --filter @lotse/db db:migrate`.
2. Open an existing case in the workspace or Helpers settings. Choose screen only, screen plus
   case overview, or screen plus case and individually selected saved facts, then invite the helper.
3. Copy the link to the helper. It expires after 15 minutes and can be claimed by one
   browser. The helper opens it and requests admission. The inviting browser must approve.
4. Both sides connect and enable their microphones. The subject chooses **Bildschirm
   freigeben** and selects this browser tab; include tab audio so the helper hears the guide.
5. The helper points, clicks to mark, or uses the arrow keys and Enter. The subject sees a
   purple cursor labelled **Hilfsperson**. Either side can end the session.

Helpers see only the approved scope. Case sharing exposes the journey without owner conversation
messages or linked artifact contents. Selected facts use exact ids; sharing a fact never shares
its complete source document. Screen-only helpers receive 403 on case-scoped `/api/facts`.
Pause all sharing revokes data access and closes the media room; resume restores the original scope.
Sessions last at most one hour and are not recorded. Sharing another window still draws the
pointer in the workspace; OS-wide/native overlay rendering is outside this web implementation.
Audio from the guide is available where the browser supports and the subject enables tab audio.

`LIVEKIT_URL` defaults to `ws://localhost:7880`, with the standard `--dev` key pair. Compose
publishes signaling (7880 TCP), media fallback (7881 TCP), and media (7882 UDP) on loopback.
For another device, configure a reachable LiveKit server address and secure WebSocket transport,
and serve the workspace over HTTPS. The supplied Compose service is for local development.
The server secret stays server-side; tokens bind the approved room, browser identity and role.
Tokens expire after 15 seconds for initial admission; self-hosted LiveKit cannot revoke an
already issued JWT. Ending a session stops local capture, deletes the room, and refuses new tokens.
The peer also checks persisted state every two seconds and disconnects on a failed status check.

The API lives under `/api/relatives`: `GET/POST invites`, `POST join`, `GET/POST session`,
`GET sessions`, and `POST token`. Every route uses `requireSession`, validates input with Zod, rejects browser
cross-origin requests, and sends no-store headers. Invite tokens travel in the URL fragment and
POST body, never in query strings. Admission state is persisted in `relative_session`, linked
to the existing single-use `helper_invite`; active sessions use `helper_session` and audit events.
The browser session, expiry, pause and end are checked on every managed helper read.
Legacy `/api/invites` URLs redirect to these routes, and `/invite/[token]` redirects to `/helper#token`.
Old invites without relatives admission state must be reissued through the current picker.

## Verification

- `bun run typecheck`
- `bun run --filter @lotse/web test`
- `bun run --filter @lotse/web test:services -- test/relatives/relatives.db.test.ts`
- `bun run --filter @lotse/web build`
- `bun run --filter @lotse/web e2e:relatives`

The focused browser runner creates, migrates and drops an isolated temporary Postgres database.
It uses port 3021 to avoid a development server on port 3000. It
requires real Postgres, MinIO and LiveKit, plus Playwright Chromium. Only browser capture devices
are synthetic test fixtures; the application, approval flow, WebRTC media and data channels are real.
Set `RELATIVES_E2E_DEV=1` to run the same suite against Webpack dev on port 3021.
`PW_TEST_CONNECT_WS_ENDPOINT` can select a compatible remote Playwright Chromium.

## Workspace settings and accessibility

Settings persist on the authenticated user's Postgres profile through `GET/PATCH /api/preferences`.
The API accepts only validated preference fields; caller identity comes from `requireSession`.
Language, simple language, address and detail preferences feed the brain's response instructions.
Autonomy remains server-owned: existing cases read the saved owner level, and changes wait until an
active answer finishes. Session reset retains preferences and historical context; it is not deletion.

First visit shows three setup steps. Setup offers installed browser/system voices with a real spoken
sample and visible transcript, display preferences, autonomy and optional analytics consent. Consent
defaults off and can be withdrawn in settings. Saving consent also updates the existing analytics
client and server consent gate; no analytics SDK or session recorder is installed. The native
analytics toggle retains its existing device-local scope.

The printable helper guide is at `/setup-guide`. Microphone, screen and accessibility permissions
remain just-in-time native capabilities. The interactive SV-Box document/form tutorial depends on the
workspace document and live-fill screens and is not included in this setup flow. Voice sampling uses
system speech; provider voice selection and native speech playback integration remain with the voice
module. Native companion size, speed and reduced motion are available in the Mac menu and are
stored as device UI preferences.

Accessibility checks cover every current workspace screen (welcome, three setup steps, settings,
helper guide), German and English, narrow layouts, keyboard focus, 44px targets, high contrast and
reduced motion. Shared conversation captions announce streaming text without a busy ancestor that
would defer speech-reader updates. Automated checks do not replace a manual VoiceOver and native
permission audit.

Run from the repository root:

```sh
bun run --filter @lotse/db db:migrate
bun run typecheck
bun run --filter @lotse/web test
bun run --filter @lotse/brain test -- test/preferences/schema.test.ts
bunx --no-install vitest run packages/brain/test/preferences/preferences.db.test.ts --hookTimeout=30000
bun run --filter @lotse/ui test
bun run --filter @lotse/web build
LOTSE_E2E_PORT=3199 bun run --filter @lotse/web e2e --grep @smoke
```

The smoke server defaults to port 3000; `LOTSE_E2E_PORT` reserves another port and the following port
for its unavailable-database check. With a matching remote Playwright server, set
`PW_TEST_CONNECT_WS_ENDPOINT` and `PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>'`. Browser tests use
real Postgres/MinIO and no product-service replacements. Apply the generated profile preference
migration before starting the updated web app.

## Conversation workspace

Open `/workspace`, or follow the conversation link on the home page. The native host's root URL
automatically enters this route. Web users create or select a case; embedded users automatically
receive an initial case. Reloading restores the server's persisted conversation.

The workspace uses `useChat` and `/api/turn`, sending only the latest SDK message alongside the
protocol request and validated client hello. Case identity comes from `x-lotse-case-id`.
Approvals use `addToolApprovalResponse`; server-verified client calls use `addToolOutput`.
Conversation content is never persisted in browser storage.

`window.__lotse.receive(envelope)` accepts schema-validated native messages. Outgoing messages
use `window.webkit.messageHandlers.lotse.postMessage(envelope)`. The receiver is available while
case history loads. Browser page tools use `@lotse/guide`; OS capabilities require the native host.
Stopping or switching cases cancels queued speech/actions and sends native speech control.

Session-authenticated adapters expose `/api/cases`, `/api/cases/messages`, `/api/facts`,
`/api/documents` and `/api/documents/[id]`. Case history uses `caseId`; facts and document
reads include `subjectId`. Existing actor-scoped reads remain available to authorized helpers.
The conversation persistence service is `@lotse/brain/workspace`; helper access to conversation
history and writes is denied. Document and fact routes use the authoritative
`@lotse/brain/documents` service, including encrypted storage, OCR, visibility and explicit confirmation.
Uploads send `subjectId` and `originClient`, then request extraction from
`/api/documents/[id]/extract`. Signed proposals stay transient until confirmed through POST
`/api/facts`. Edits use PATCH with explicit confirmation; rejection of a saved fact uses DELETE.
Document citations carry subject scope. Medical recommendations retain their verbatim wording.

Checks from the repository root:

- `bun run typecheck`
- `bun run --filter @lotse/web lint`
- `bun run --filter @lotse/web test`
- `bun run --filter @lotse/brain test:workspace` — real Postgres/MinIO ownership and persistence
- `bun run --filter @lotse/web build`
- `bun run --filter @lotse/web e2e:workspace` — built server on port 3016, real persistence,
  fact review, upload/download, citations, axe WCAG 2.2 AA, native transcript and a live model turn

The browser suite requires configured local services and the live model key already used by the
brain. If macOS sandboxing blocks Chromium, use an existing matching Playwright server via
`PW_TEST_CONNECT_WS_ENDPOINT`; the suite exposes only loopback to that browser.

The focused backend additions, optional `clientHello` turn parsing and omission of unavailable
source dates in `WhyPanel` are small cross-package deviations needed by this workspace slice.

### Spoken source highlights (FR-D4)

`GuidanceProvider` is the shared playback clock and source viewer. Feed protocol data parts to
`useGuidance().ingest` (for example from `useChat.onData`); the included stream host consumes the
real `/api/turn` SSE response. Browser `SpeechSynthesisUtterance.onstart` and native bridge
`SpeechControl(state: speaking, segmentIndex)` trigger the same sentence queue. Arrival, idle,
audio end and stop never clear a source mark. A subsequent highlight/clear action or completed
step replaces it. Call `beginTurn` before a new stream so repeated sentence indices cannot reuse
old actions. The `lotse:guidance-part` event is also available to stream adapters.

Stored originals and page metadata are loaded from `/api/documents?caseId=…&documentId=…`
(with `metadata=1` for metadata). Case identity is resolved in brain and reuses persisted actor,
helper-session and document scopes; object keys are never exposed. Existing actor/subject queries
remain supported. PDF.js renders the original and a selectable text layer. Quote matching changes
whitespace only and rejects ambiguous matches. Stored OCR fallback accepts pages shaped as
`{ page, width, height, lines: [{ text, bbox: { x, y, width, height } }] }`, using one-based pages
and top-left page coordinates. Unknown metadata falls back to the PDF text layer; an unmatched
quote produces an explicit status instead of an approximate highlight.

Run `bun run e2e --config playwright.source.config.ts` against a running app (default
`http://localhost:4343`, override `SOURCE_TEST_URL`). This test uses real Postgres, MinIO and an
original SV-Box PDF, with a test-only controlled speech clock. It checks source geometry,
playback timing below 600 ms for an already displayed page, persistence on stop and access denial
for another session. Remote Chromium uses `PW_TEST_CONNECT_WS_ENDPOINT` as in other browser tests.

## Grouped settings

The header settings panel groups profile and language, assistant permissions, voice, privacy,
helpers and connections. Profile, accessibility, voice and analytics preferences persist through
`/api/preferences`; saving explicitly confirms a changed autonomy level. Only edited fields are
sent, so changing another preference cannot silently overwrite the header's quick autonomy control.
The saved voice is the system fallback voice; the online ElevenLabs voice remains the server's
language-specific voice. Saved speed applies to online playback and system speech. The global
push-to-talk shortcut is managed in the native Mac settings window.

Export downloads a real archive from `/api/export`. Deletion requires an explicit review step and
calls `/api/account`; session reset retains the existing user's exportable data. Helper invites
persist the subjects share scope through the relatives service and require approval before granting
access. Settings uses the same relatives picker and admission flow as the workspace.
Existing helper sessions reload from the server and can be paused, resumed or ended.
Invite links are shown only when created; bearer links are never stored in browser storage.

`GET /api/health/details` requires a valid session and returns private, uncached live results for
brain configuration/profile access, Postgres, object storage, OpenAI, ElevenLabs and LiveKit.
A stored key alone is not reported as verified: provider checks authenticate, and ElevenLabs also
checks that both configured voices are available. Each dependency is bounded to five seconds;
errors are reduced to `not_configured` or `unreachable`, without credentials or provider bodies.
The panel refreshes checks while open and offers repair guidance and an explicit retry.

Focused checks:

```sh
bun run --filter @lotse/web test -- test/settings.test.ts test/health-details.test.ts
bun run --filter @lotse/web e2e --grep 'settings groups|helper invites preserve|connection details|privacy exports'
```

The browser tests use real Postgres, object storage and provider connections. They create their own
anonymous users and helper fixtures; the privacy test deletes only its own test user's account.
Use a disposable migrated database as described above.

The final onboarding step is a skippable, captioned tutorial backed by the fictional administrative
letter exported from `@lotse/knowledge/demo/onboarding-letter`. It uses the guide's real quote
highlighting and the form viewer's typing routine, then requires an explicit local demonstration
confirmation. It creates no documents, facts, form instances or model turns. Cursor size and speed
are saved with profile presentation preferences and apply to the guide and form viewer; both the
saved reduced-motion setting and the operating-system preference suppress animation.

`e2e/shell.spec.ts` scans the main routes in German and English with axe WCAG 2.2 AA rules and
covers tutorial keyboard confirmation and cursor preference persistence without model calls.
