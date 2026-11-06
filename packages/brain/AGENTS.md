# @lotse/brain

## Scope

The TypeScript brain owns agent orchestration, tools, the process engine, context assembly, guards
and model routing. It is hosted by the web app and contains the product's business logic. Shared
persistence belongs to `@lotse/db`.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/brain typecheck` — check source and test types.
- `bun run --filter @lotse/brain test` — run Vitest under Node.js, excluding `test/**/*.db.test.ts`.
- `bun run --filter @lotse/brain test -- test/forms/detect` — real SV-Box AcroForm/flattened tests and E13 fixture harness; no provider calls.
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/runtime` — authenticated `/api/turn` handler with real OpenAI and persisted messages. Requires the Compose services and runtime environment; no keys or response content are logged.
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live` — all live tests, including the existing form vision test. Optional positional filters match test paths.
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/forms/detect` — rasterize an original SV-Box page and detect fields through real OpenAI. Requires `OPENAI_API_KEY`; `FORM_VISION_MODEL` defaults to `gpt-4.1-mini` and can be overridden. Loads root `.env.local` without overwriting exported values.
- `bun run --filter @lotse/brain test:deadlines:integration` — deadline guard acceptance tests against real Postgres; creates and drops a unique migrated database. Loads root `.env.local` without overriding exported values.
- `bun run --filter @lotse/brain test:db` — deprecated delegate to `@lotse/db test:db`.
- `bun run --filter @lotse/brain test:integration` — existing database/MinIO suite, then runtime approval and persistence tests in disposable real Postgres databases.
- `bun run --filter @lotse/brain db:generate` — deprecated delegate to `@lotse/db db:generate`.
- `bun run --filter @lotse/brain db:migrate` — deprecated delegate to `@lotse/db db:migrate`.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. Run TypeScript tooling scripts with
`bun <file>.ts` and use only Node APIs so they also run under Node. `test` runs without services.
The deprecated database scripts and the exports `./db`, `./db/schema`, `./db/approvals`,
`./db/migrations` and `./storage/s3` remain for in-flight work packages; WP-014 removes them.
New code imports `@lotse/db` directly. Persistence commands, service setup and invariants are in
[`packages/db/AGENTS.md`](../db/AGENTS.md). Until WP-014 migrates knowledge off the compatibility
exports, brain must not add a dependency on knowledge; afterward brain may depend on knowledge,
and knowledge must never depend on brain. Db remains a leaf workspace package.

## Invariants

- No benefit, scenario or office id in code.
- Every tool has Zod input and output.
- Approval record, HMAC and input hash checked before approval-gated tools.
- History loaded from Postgres, never trusted from the client. `/api/turn` bodies contain protocol
  `TurnRequest` fields plus `message`; only the last item of a legacy `messages` array is accepted.
  Only server-issued tool decisions and client outputs can update an assistant message.
- `createLotseAgent` uses `prepareStep`/`activeTools`, `toolApproval` and
  `experimental_toolApprovalSecret`. L1 excludes approval tools and `form.fillLive`; helpers cannot
  approve or mutate cases/reminders. Read autonomy from the self subject owner's profile, default L1.
- Client tools have no `execute`. Gated client previews use input-start/delta; input-available is
  emitted only after the approval transaction consumes the record. Never expose an early
  input-available event that could trigger `onToolCall` before approval. Do not await `addToolOutput`
  inside `onToolCall`; OT-12 exercises the real SDK auto-send loop against Postgres.
- Helper conversation access requires `shareScope.case === true`. Fact scope is
  `shareScope.facts === true` or a list of allowed fact types; absent scope denies access.
  Until history has an authorized projection, `/api/turn` also requires full fact scope
  (`facts === true`) for helpers: owner history may repeat unshared facts in prose or tool results.
- Keep PRD dotted tool names in all contracts/history/approvals. OpenAI model middleware translates
  only provider-facing names to reversible aliases. It maps both historical and newly streamed calls.
- The agent step-end callback waits for its UI message's database checkpoint before the next model
  call. Turn claims serialize requests per case; model timeout is shorter than the crash lease.
  Every checkpoint and finalization locks the case and verifies the running turn claim before
  writing messages or status. A superseded writer fails with `TURN_SUPERSEDED`.
  Resumed server approvals have no SDK step-end boundary: `onToolExecutionEnd` persists their
  results/errors before the next model call. SDK callback errors are swallowed, so `prepareStep`
  must explicitly reject continuation after a failed result checkpoint.
  Interrupted-turn recovery resolves consumed approvals without results as `TOOL_INTERRUPTED`.
  Never redispatch or re-execute them; retries require a new call and approval. Preserve pending
  unconsumed approvals. A fresh user message resumes recovery; replayed approvals remain rejected.
- Brain config is Zod-validated on runtime initialization. Optional model overrides and fallback
  overrides stay out of `.env.example`; blank overrides mean absent. Stubs need explicit
  `BRAIN_ALLOW_STUBS=1` and otherwise throw `ToolNotImplementedError`; fixtures never run implicitly.
- Group implementations live under `tools/impl/<group>/index.ts`. Replace one group's factory in
  later WPs without modifying the registry; `package.build` is in the form group.
- Override the SDK's default error logger: it includes provider requests and response headers.
  Expose fixed error codes and keep telemetry input/output recording disabled.
- No import from `apps/*`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.
- `@lotse/brain/forms/detect` returns `auto` drafts only. Boxes use the displayed PDF CropBox in
  points, top-left origin, one-based pages, including rotation. `mode: "acroform"` reads exactly
  one field per widget; the default `auto` mode also detects missing fields from page content.
- Form detection owner headers are data in `src/forms/detect/owner-patterns.json`. Detection joins
  nearby fragments and up to three adjacent, left-aligned lines with normalized whitespace.
  Sections persist across pages until the next header; a heading within 80 points of the top also owns
  running-header identifiers. Doctor/hospital fields are never implicitly reassigned to applicants.
  Vision ownership is reconciled onto overlapping widgets before duplicate suppression; recompute
  the signature flag using the preserved widget type. Comb grouping starts at the leftmost cell
  in spatial order and emits each cell once, independently of PDF drawing order.
- Vision configuration is validated only when needed. Scanned rendering uses PDF.js's optional
  Node canvas, or a caller-supplied real `renderPage` implementation; absence fails explicitly.
  Keep provider calls behind `detectVisionFields`; never log page content or provider errors.
- Detection fixtures read `SVBOX_DIR` relative to the repository root (absolute paths also work).
  Original PDFs are read-only; flattening and rasterization happen in memory. Live tests are
  excluded from the offline `test` script and run only through `test:live`.
- Audit records contain only opaque identifiers and action names, never user content. They have no
  cascading foreign keys; the database rejects UPDATE, DELETE and TRUNCATE.
- Only `vector` and `pgcrypto` extensions are installed. Embeddings have 1536 dimensions; changing
  this requires a migration and re-embedding. Austrian synonyms expand at query time.

## Deadline guard

- `@lotse/brain/deadlines` is a server-only core API; callers authorize the case before access.
- Fact values accepted by the guard are explicit `{ title, dueAt }` objects with a confirmed state
  and a nonempty verbatim `source.quote`. `dueAt` is an ISO date or a timestamp with an explicit
  offset. Relative deadlines and unstructured text are not inferred.
- `syncCaseDeadlines` reads facts for the case subject and steps for that case from Postgres.
  Supply the complete `stepSources` list from process definitions (`stepId`, `title`, `sourceQuote`);
  steps without a supplied quote are not converted. No process quote is invented from a step key.
- Reminder identity is the case plus fact/step row id, independent of date/title. Reconciliation
  locks the case and upserts deterministic UUIDv8 ids. Call it after facts/steps change; obsolete
  guard reminders are removed, while reminders from other writers are preserved.
- Date-only deadlines expire at the end of that Vienna day and export as all-day VEVENTs. Timed
  exports include IANA-derived Vienna observances; the second occurrence of a repeated hour uses
  UTC because RFC 5545 resolves a local repeated time to its first occurrence. Calendar precision
  is seconds. UIDs stay stable across edits and exports.
- Offline calendar tests use a dependency-free RFC 5545 test parser scoped to emitted content lines,
  components, dates, offsets and TEXT. No calendar dependency or service is added.

## Evaluation suites

Keep applicable E1–E13 suites green as brain features land; E2 enforces data-driven logic and E5 enforces the medical boundary. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/brain/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
