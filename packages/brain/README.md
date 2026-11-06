# @lotse/brain

The TypeScript brain owns agent orchestration, tools, the process engine, context assembly, guards, model routing and persistence. It is hosted by the web app and contains the product's business logic.

## EKO coverage and reimbursement (FR-M1, FR-M2)

`eko.lookupCoverage({ medicineNameExact })` uses the real knowledge EKO loader.
It matches the complete product name, with whitespace/case/Unicode normalization,
and returns the existing coverage contract. ATC codes in rule quotes are redacted;
private indication files and prices are excluded. Mixed pack boxes produce `box: null`
and an explicit qualification; `approvalRequired` then means at least one matching
pack requires prior approval. RE2 and green restrictions remain conditional.
The fee, cap and exemption data retain their sources and dates. The medicine export
is undated, so the result identifies its source review date without claiming live
coverage. The frozen contract carries these qualifications in `exemptionRule`.
Substance lookup is unsupported because the supplied export has no reliable mapping.

`fees.explainReimbursement({ tariffPositionId?, serviceDescription? })` loads both
real SV-Box fee schedules and the sourced administrative rules in knowledge.
The description matches published tariff text; it never interprets symptoms.
A unique, complete euro tariff that includes ÖGK yields a rounded illustrative
80% amount with region, carrier, date and PDF page. Ambiguous rows, other carriers,
points and tariff components yield no amount. Results explain the invoice cap,
required documents and portal/post channels, and provide the submission checklist.
This read-only tool does not assemble stored attachments or submit a package;
the existing case/form package workflow owns artifact assembly and user review.

Both tools run with `allowStubs: false`, load data lazily, and return fixed error
codes if source data is missing or invalid. They resolve `SVBOX_DIR` from the
repository location, independently of the working directory. Knowledge now imports
the shared database package directly, avoiding a brain/knowledge dependency cycle.

```sh
bun run --filter @lotse/brain test -- test/tools/coverage-reimbursement.test.ts
bun run --filter @lotse/knowledge test -- test/loaders/eko test/loaders/fees test/e2
```

## Autonomy and guided booking (FR-A1, FR-O6)

`@lotse/brain/autonomy` exposes `createAutonomyService(db, authenticatedUserId)` and
`bookingGuideConfiguration(db, caseId, authenticatedSession)`. New profiles default to L1;
settings writes require `{ autonomyLevel: "L1" | "L2" | "L3", confirmed: true }`. Settings affect
only the session user's profile. Case permissions continue to use the self-subject owner's profile,
so changing a helper's profile cannot enable actions in someone else's case.

The web panel uses `GET` and `PATCH /api/settings/autonomy`; writes reject cross-site origins.
`prepareStep` refreshes stored level and role before each model step. Existing viewer fills at L2
remain supported. DOM fills (FR-D7) are allowed at L2 and L3 on HTTPS pages whose exact origin is in
the `@lotse/knowledge` portal policy (`allowlist.yaml`), never on login or identity-provider pages
(`isPortalLoginPage`, patterns in `packages/knowledge/data/portal-login-pages.json`). DOM booking
fills (FR-O6) stay L3 only: a URL that extends a sourced, verified `appointment_channels` URL (same
path, same query parameters) is fillable only at L3 and only as that exact URL. Every `ui.fill` needs
its own server-side approval before typing; the guide's submit/book deny list applies at execution.
The exact URL, value and provenance are bound to the approval hash. Approval consumption rechecks the
page policy and current turn authority.

`GET /api/guide/booking?caseId=<uuid>` returns trusted guide options after session/case authorization.
The host passes them to `createGuide` and forwards only the server's approved `ui.fill` dispatch to
`guide.executeApprovedFill`. General site/contact URLs never imply booking permission. The current
catalog has no reviewed booking channels: filling stays disabled until sourced channels are reviewed
and loaded. Appointment artefact preparation belongs to the appointment tools; no booking page is invented.

```sh
bun run --filter @lotse/brain test:autonomy:integration
```

These tests use a disposable real Postgres database. Test-only booking review fixtures exercise policy
without asserting that a publisher home page is a real booking page.

## Durable jobs and conversation resume (FR-C9, FR-C10, NFR-4)

`@lotse/brain/jobs` exports `enqueueJob(db, input, authenticatedIdentity)`, `runJobs(db)` and
`getJob(db, jobId, authenticatedIdentity)`. Enqueue a `caseId` and a `tasks` array of
`{ toolName, input }` objects. Inputs/outputs use the existing tool contracts. The worker always
disables stubs and invokes the current real implementation; an unavailable tool fails explicitly.
Only repeatable reads and draft generation in `BACKGROUND_TOOL_NAMES` are permitted. Approval,
native capabilities, submission and case mutations cannot be scheduled.

Each completed step commits its result before the next begins. Jobs retain attempts, a fenced
lease, retry time and completed results in `job.step_state`; no schema change is needed. A new
worker reclaims an expired lease and continues at `nextStep`. The failed or interrupted current
step may run again with the same `jobId:index` tool call id, so draft implementations must tolerate
replay. Three failures end the job; clean time-budget yields preserve progress without using a retry.
Case access and the originating session are checked again for every step; revoking that session
stops further private reads.

The web host exposes:

- `POST /api/jobs`: enqueue an authorized case's tool bundle; returns 202 with `data-job-progress`.
- `GET /api/jobs/:id`: authorized status, results and a `data-job-progress` part.
- `GET` or `POST /api/jobs/worker` (PRD name; `/api/jobs/run` is kept as an alias): bounded
  worker batch, authorized only by `Authorization: Bearer <CRON_SECRET>`. Missing configuration
  fails closed. Vercel calls this every minute; other hosts can invoke the same route from their
  scheduler.
- `GET /api/cases/:id/conversation`: authorized persisted SDK messages and job progress.
- `POST /api/cases/:id/conversation`: explicit resume. It transfers only pending, unconsumed
  approvals to the same actor's current session; HMAC/input verification and session binding still
  apply when answering. Consumed calls with uncertain results become `TOOL_INTERRUPTED` and are
  never executed again using the old approval. A running turn must finish or its lease expire first.
- `/cases/:id`: reloads that history into `useChat`, shows pending approvals and polls job progress.
  `useCaseConversation` accepts the workspace's native/client-tool callback. Without a capability
  adapter, the standalone case page returns an explicit capability error for client tools.
  Completion notices use browser speech when available and emit `lotse:job-completed` for a native
  voice adapter. No conversation or job content is stored in browser storage.

Progress is polled and included in normal turn streams. Workers never append assistant messages
behind a pending approval. Original requesting sessions must remain valid; this does not implement
cross-device account pairing or transfer private context to a new anonymous user.

Verification: `bun run typecheck`, `bun run --filter @lotse/web test` and
`bun run --filter @lotse/brain test:continuity:integration` (real Postgres; disposable databases).

## Catalog and process tools (FR-G1–G3, FR-G7, FR-K5)

Load the sourced YAML catalog into Postgres before using these tools:

```sh
bun run --filter @lotse/knowledge catalog:load
bun run --filter @lotse/brain test -- test/engine
bun run --filter @lotse/brain test:engine:integration
```

`catalog.findBenefits` ranks benefit names and life situations against the goal and evaluates
criteria using subject facts. Each criterion remains `met`, `unknown` or `not_met` with its original
source. Unstructured criteria and missing values remain unknown. `catalog.getBenefit` returns the
complete loaded record, including its review date only when the record has one.

The server-only `@lotse/brain/catalog` entrypoint reads the same loaded records for HTTP hosts:
`listCatalogBenefits(db, query)` validates every record and filters by `lifeSituation` (exact,
case- and accent-insensitive), `carrier` and free text `q` (all terms must match id, names or life
situations). `GET /api/catalog/benefits` exposes it to authenticated sessions.

The pure engine in `src/engine/` runs the process graph without a model. The tool adapters require a
persisted subject actor and a confirmed goal. After the user confirms the goal, save it using
`case.update`, call `process.start`, and obtain questions using `process.nextStep`. Only the latter
issues a question and checkpoints its slot as asked. Answers are validated and stored as sourced
draft facts; fact confirmation remains explicit. A changed goal requires `process.start` again.

Step completion accepts evidence `{ type: "user_statement", text }`,
`{ type: "document_present", documentId }` or `{ type: "artefact_built", artifactId }` when the
definition permits that kind. Document and artefact references are checked against the subject/case.
The step row UUID or active definition step key identifies the step. Conditional successors,
checklists, task reminders and completion evidence are persisted in one case-locked transaction;
retrying completion does not duplicate them. Other artefacts, such as signed forms or user documents,
remain the responsibility of their dedicated tools and are never fabricated by the engine.

Engine checkpoints use `case.journey_map.process`; step keys use `<process key>/<step key>`.
No database migration or knowledge-to-brain dependency is added. Integration tests invoke the real
catalog loader against a disposable migrated Postgres database and require `CREATEDB`.

## Deadlines and administrative letters (FR-K2, FR-D8)

The registry provides `reminder.create`, `reminder.list`, `reminder.extract` and
`docs.explainLetter`. All check the current case and persisted subject actor. Helpers cannot
use these tools because the results may contain unshared document/fact content.

- `docs.explainLetter({ caseId, documentId })` reads completed stored OCR and uses the model router's
  extractor. It returns simple German explanations with exact page quotes for the summary, required
  actions, deadlines and stated next steps. It saves nothing. Non-administrative documents are refused;
  the prompt prohibits legal advice and medical interpretation. Fabricated or misplaced quotes fail closed.
  The source's hash, OCR status and pages are rechecked after extraction; changed OCR cannot produce
  an explanation or saved reminders from stale text. Reminder persistence locks that source until commit.
- `reminder.extract({ caseId, documentId? })` reconciles explicit dated, confirmed facts and optionally
  the letter's printed absolute dates. Unconfirmed facts are ignored. Relative deadlines remain in
  `unresolvedDeadlines`; receipt dates and legal periods are never calculated. Printed ISO and numeric
  day.month.year dates are supported; other date formats remain unresolved. Repeated extraction preserves
  reminder identity and creation time, and leaves manual/process/other-document reminders intact.
- `reminder.create({ caseId, dueAt, title, sourceQuote })` accepts an ISO date or offset timestamp and
  stores a sourced reminder, with identical retries deduplicated. Date-only deadlines use the end of
  the Vienna day; the calendar preserves them as all-day events. Old reminder.create records remain readable.
- `createDeadlineService(db, authenticatedUserId)` is the authorized public server API at
  `@lotse/brain/deadlines`. The existing `syncCaseDeadlines` API remains available for process
  integrations with process-definition quotes.

The web host exposes `GET /api/reminders/ics?caseId=<uuid>` with the session cookie. It returns a
private, non-cacheable `.ics` download, containing the original source quotes. Downloading does not
write to the user's calendar; `calendar.createEvent` retains its separate approval requirement.

Verification:

```sh
bun run typecheck
bun run --filter @lotse/brain test
bun run --filter @lotse/web test
bun run --filter @lotse/brain test:deadlines:integration
RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/deadlines
```

Integration tests use disposable real Postgres databases. Live tests use synthetic administrative
letters through the real OpenAI extractor, keeping real personal documents out of provider tests.

## Case file, handoff and portability

The server-only `@lotse/brain/case-file` entrypoint exports `createCaseFileService`,
`createHandoffService` and `createPortabilityService`, each bound to a server-authenticated user.
Services use the existing case/step/document tables; no new migration is required.

- `GET /api/cases` lists accessible cases. `GET /api/cases/:id` returns the subject, canonical
  `steps`, a JSON `journeyMap` derived from those steps, and reminders. Step entries carry
  `processStep`, `status`, `owner`, `dueAt`, `linkedArtifacts` and `initiatedBy`.
- `POST /api/cases/:id/steps` creates a step; `PATCH /api/cases/:id/steps/:stepId` accepts a
  partial step update. Creation requires `processStep`, `status`, `owner` and nullable ISO
  `dueAt`. `PATCH /api/cases/:id` updates the goal, life situation or case status.
- `GET /api/cases/:id/history` returns ordered message parts, approval request/decision records,
  action results and audit records. `GET /api/cases/:id/replay` returns the original UI messages
  and timeline as inert JSON; clients must render replay without dispatching tools.
- Case, process, reminder and handoff tools emit typed `data-case-event` stream parts. HTTP step
  changes and handoff generation append the same parts to persisted history. HTTP writes return
  409 while a live turn owns the case, protecting message positions and approval continuations.
- `POST /api/cases/:id/handoff` creates a PDF in MinIO/R2 and registers it as a subject document.
  The optional JSON body is `{ "scope": ["steps", "documents", "reminders", "facts"] }`.
  The default omits facts. Unknown scopes fail closed. Only confirmed facts are included, and
  their sources are quoted without interpreting findings. The result contains `documentKey`
  and `downloadUrl`; the authenticated GET downloads the PDF. No document is sent externally.
  The real `handoff.compose` tool returns that document identifier. PDF JSON attachments preserve
  original Unicode; the standard PDF font renders unsupported glyphs as explicit codepoints.
- `POST /api/export` returns a ZIP with `data.json`, original documents, generated
  handoffs and form outputs. The manifest maps safe archive names to storage keys. It includes
  facts, cases, messages, approvals, audit, reminders, jobs, helper metadata and account/profile
  data. HMACs and invite hashes are excluded.
- `DELETE /api/account` deletes all authorized subjects and the caller's account/sessions.
  Supply `subjectId` as a query parameter or JSON body to export/delete one authorized subject
  while retaining the account. Conflicting body/query ids are rejected. Deletion removes original documents, handoffs and form outputs;
  shared object keys remain while another subject references them. Failed storage deletion keeps
  database references for an idempotent retry. Append-only audit records retain opaque ids only,
  as required by the existing database contract; their deletion is deliberately not attempted.

Owners and persisted subject actors can mutate/export/delete. Restricted helpers cannot read
history, export subjects or retrieve PDFs; full case shares allow read-only history/download.
All routes require the session cookie, use private/no-store responses, reject cross-origin
browser writes and return content-free errors.

Run `bun run --filter @lotse/brain test:case-file` for real Postgres/MinIO acceptance tests and
`bun run --filter @lotse/web test -- test/case-file.test.ts` for HTTP adapter checks. Tests use
an isolated migrated database and a unique object-storage prefix.

## Subjects, helper invitations and scope (FR-P7, FR-R1, FR-R4, FR-R5)

`createSubjectService(database, userId, sessionId?)` at `@lotse/brain/subjects` accepts only
server-authenticated identities. HTTP callers supply both identities from `requireSession`.

- `POST /api/invites`: `{ caseId, shareScope, expiresAt }`. Returns a one-use link and expiry.
  Expiry is mandatory, in the future, and at most 24 hours away. Only the token hash is stored.
- `POST /api/invites/accept`: `{ token }`. Records a **pending** request, bound to the helper's
  current browser session. Returns `202`; it does not grant a case actor or data access.
- `POST /api/invites/approve`: `{ joinId }`. The subject or case owner approves the pending join;
  issuer authority and expiry are rechecked. Creates the helper actor atomically.
- `GET /api/invites/sessions?caseId=…`: owner/subject lists pending and active sessions.
  `GET /api/invites/accept?joinId=…`: participant reads their status.
- `PATCH /api/invites/sessions`: `{ joinId, action: "pause" | "resume" | "end" }`.
  The owner/subject pauses or resumes; either participant ends. Pause removes context access;
  end removes the helper actor. The browser invite page displays status and offers an end control.
- `GET /api/facts?actorId=…&subjectId=…` and `GET /api/documents?actorId=…&subjectId=…`
  read only that persisted actor's scope. Add `documentId=…` for an authorized attachment download.
  Document storage keys never appear in metadata responses. A fact quote never grants access to
  the whole source document.

Scopes are `{ mode: "full" }` or `{ mode: "restricted", factTypes: [], factIds?: [],
 documentIds?: [], case?: boolean }`. Restricted lists grant exact types or individual ids, without
wildcards; `case: false` grants screen-only access and no facts or documents. Existing runtime
`{ case, facts, documents }` scopes remain readable. Malformed scopes deny access. Scopes from other
cases are never combined. The fact tool reloads the actor per execution, including during a turn.
Until case history supports a safe projection, helpers with partial fact or document access cannot
use `/api/turn`; they can use the scoped read APIs. Helpers cannot approve fields/signatures or run
approval-gated tools, including at L3. Screen/audio recording is not introduced by these APIs.

The pre-existing `acceptHelperInvite` service method remains for trusted server integrations;
browser callers always use `requestHelperJoin` plus `approveHelperJoin`.

The turn route allows 30 requests per session per rolling minute, with a stricter limit of five
helper approval continuations. Counters use Postgres session row locks and append-only audit events,
so parallel server processes cannot bypass them. Rejected requests return `429` with `Retry-After`.
Audit payloads contain identifiers only. No new table or migration is required.

Verify with `bun run --filter @lotse/brain test:subjects`, `bun run --filter @lotse/web test`, and
`bun run typecheck`. The subject suite creates a disposable real Postgres database.

## Turn observability (PRD §15, NFR-12)

`handleTurn` owns a `lotse.turn` OpenTelemetry span through stream finalization, with a child context
assembly span and the SDK's model and tool spans. `@lotse/brain/telemetry` exposes a content-free
turn handle for additional classification, safety-net, retrieval, guard and verifier stages.
`turn.timings` stores latency, stage timings, token totals, estimated USD cost and pricing completeness;
`turn.modelIds` stores the actual returned model ids. Case cost is the sum of persisted turn costs.
Failed/interrupted model steps and unknown model prices remain explicitly incomplete.

Rates for the default mini/nano models use the standard OpenAI text-token prices, including cached
input and reasoning output. Sources and the verification date are in the brain config module.
Override all rates with `LOTSE_MODEL_PRICING_JSON`, a JSON object mapping model id to nonnegative
`input`, `cachedInput` and `output` USD rates per million tokens. Supply deployment-specific rates
for other models, regional processing or different service tiers. Unknown rates never count as known
zero cost. Speech/provider-tool charges are outside this text-model estimate.

Optionally set `LOTSE_CASE_BUDGET_USD` to a positive amount. Crossing the budget emits
`lotse.case.budget_exceeded`; subsequent turns choose `OPENAI_MODEL_ORCHESTRATOR_FALLBACK` when
configured, without a fallback to the more expensive primary after partial output. Configure a
cheaper fallback and its pricing together. Without a configured fallback, the alert still fires.

Verify with `bun run --filter @lotse/brain test -- test/telemetry` and
`bun run --filter @lotse/brain test:telemetry:integration` (real local Postgres, disposable database).

## Guarded turn pipeline and retrieval

`handleTurn` (and therefore the existing authenticated `/api/turn` route) now runs SR-1 before
classification, classifies language/intent, confirms a proposed goal with the subject, and assembles
context from Postgres. Pending goals live only in server-owned assistant metadata. A classifier
confirmation must also match explicit affirmative language before the goal is written under the turn
claim lock. Medical requests receive the administrative handoff.

Context uses the PRD shares in `CONTEXT_SHARES` (15/5/10/15/30/15/10) with a configurable-by-code
16,000-token estimate. JSON entries and passages stay whole. Active process steps select fact types;
only confirmed facts within the actor's subject/share scope enter context. State is refreshed before
every agent step. The existing per-step persistence/approval checkpoints remain in place.

`kb.search` is implemented against `kb_chunk`: German `tsv` plus cosine pgvector candidates,
reciprocal-rank fusion, source and chunk validity (exclusive end), carrier/region/area filters, and
Austrian query synonyms from `packages/knowledge/synonyms.yaml`. Vector matches require the configured
embedding model identity. Embedding outages degrade to full-text; SQL failures do not become invented
answers. Ingestion and retrieval default to the same 1536-dimensional embedding model.

After the agent loop finishes, buffered model text and display labels pass the rule guard, the model-router boundary/support classifier,
and passage-ID verification before caption/speech/action emission. A failed verifier/provider yields
fixed copy, and rewritten answers discard queued display actions. Speech uses zero-based sentence
indices across the whole turn, including an SR-1 notice. Actions attach to the following spoken
sentence and their IDs appear on its `SpeechSegment`. Raw reasoning/source events are not forwarded.

The turn stores speech segments and stage timings (`safetyMs`, `classificationMs`, `retrievalMs`,
`assemblyMs`, `guardMs`, `contextReadyMs`, `firstSegmentMs`, `totalMs`). `firstSegmentMs` measures server
emission, not audible client playback. NFR-1 needs a client STT/TTS latency run; no p50/p95 audio claim
is made here. Text is held until verification completes, so guard latency remains on the first audio
path. RRF is implemented; the PRD's downstream cross-encoder is not configured.

Validation:

- `bun run typecheck`
- `bun run --filter @lotse/brain test`
- `bun run --filter @lotse/brain test:integration` (real Postgres/MinIO plus runtime, context and retrieval)
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/pipeline` (real OpenAI and indexed corpus)

First ingest the official corpus with `bun run --filter @lotse/knowledge ingest:pilot`.
See the knowledge package's ingestion README for the source manifest and dry run.
