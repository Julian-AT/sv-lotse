# ADR 0006: agent runtime and server-owned approvals

- Status: accepted
- Date: 2026-11-05

## Decision

Use AI SDK 7 `ToolLoopAgent` in `@lotse/brain`, hosted by the thin Next.js
`POST /api/turn` handler. Postgres owns messages, turns and approvals. The runtime
has no dependency on Next.js, browser APIs or the Mac host. W1 supplies the process
engine, guards, context assembly and sentence segmentation; this policy prefix
is explicitly versioned `lotse-policy/1`, not a substitute for those guards.

The wire body contains the protocol's `TurnRequest` fields plus `message` (the
latest SDK UI message). For compatibility, `messages` is accepted and only its
last entry is read; `message` takes precedence. Earlier client history is never
validated as conversation state, passed to the model or saved. User messages
contain text; assistant continuations may change only a stored pending tool's
approval decision or a dispatched client tool's output. The UI receives its
server-selected case through `x-lotse-case-id` and should retain it for subsequent
requests. There is no separate approval route.

`parseTurnBody` uses `TurnRequestSchema` from `@lotse/protocol` and the SDK's
`validateUIMessages` validates UI parts. The route imports this public brain
adapter, avoiding a second protocol validation implementation in the web app.
No shared protocol or database schema changes are needed.

## APIs verified

Verified against the official current documentation and installed `ai@7.0.163`
and `@ai-sdk/openai@4.0.109`.

- [`ToolLoopAgent`](https://ai-sdk.dev/docs/agents/building-agents): `instructions`,
  `prepareStep`, `activeTools`, `toolApproval` returning `user-approval`,
  `experimental_toolApprovalSecret`, `runtimeContext`, `toolsContext`,
  `onStepEnd`, `onToolExecutionEnd`, `isStepCount`, `stream`, `timeout`, `maxOutputTokens` and
  `telemetry: { recordInputs: false, recordOutputs: false }`.
- [`Runtime and Tool Context`](https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context):
  `tool`, `contextSchema` and execution options `context`.
- [`Tool approvals`](https://ai-sdk.dev/docs/agents/tool-approvals): SDK
  `tool-approval-request`, UI `approval-requested`/`approval-responded`, and
  `addToolApprovalResponse({ id, approved, reason })`.
- [`Tool execution lifecycle`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent):
  `onToolExecutionEnd`, `ToolExecutionEndEvent` and the `toolOutput.type`
  discriminant (`tool-result` or `tool-error`).
- [`UI streams`](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data):
  `createUIMessageStream`, writer `write`, `originalMessages`, `generateId`,
  `onStepEnd`, `onEnd`, `createUIMessageStreamResponse` and
  `convertToModelMessages`. Display implementations write `data-action` with
  the supplied runtime sentence index; W1's segmenter will advance that index.
- [`Chatbot tool usage`](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):
  `DefaultChatTransport`, `onToolCall`, `addToolOutput`, `sendAutomaticallyWhen`,
  `lastAssistantMessageIsCompleteWithToolCalls` and
  `lastAssistantMessageIsCompleteWithApprovalResponses`. Do not await
  `addToolOutput` inside `onToolCall`: it can deadlock the SDK's job executor.
- [`Model middleware`](https://ai-sdk.dev/docs/reference/ai-sdk-core/wrap-language-model):
  `wrapLanguageModel`, middleware `specificationVersion: "v4"`,
  `transformParams`, `wrapGenerate` and `wrapStream`.
- OpenAI provider `createOpenAI`, `responses` and `embedding`; SDK test models
  `MockLanguageModelV4` and `simulateReadableStream` exist only in test files.
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions):
  `transaction`, `select().for("update")` and conditional `update().returning()`.

The SDK's default `onError` logger includes request bodies and response headers.
The agent replaces it with a silent handler; HTTP/stream errors expose fixed
codes only. Telemetry excludes input/output content and host telemetry excludes
runtime/tool context. Neither signing key nor database HMAC leaves the server.

## Model routing and contracts

Roles are `orchestrator`, `classifier`, `guard`, `extractor` and `embedding`.
Defaults are GPT-5.4 mini for orchestration/guard/extraction, GPT-5.4 nano for
classification and `text-embedding-3-small` for embeddings. Optional
`OPENAI_MODEL_<ROLE>` and `OPENAI_MODEL_<ROLE>_FALLBACK` overrides are validated
by Zod. Blank optional overrides mean absent. They are not added to
`.env.example`. Configuration is cached when the server runtime initializes;
importing public types/contracts during a build requires no provider call.
Fallbacks run only if the primary fails before producing a response stream;
partial streams are never restarted, preventing duplicated tool calls.

OpenAI rejects dots in function names (observed live HTTP 400). Middleware uses
collision-checked `lotse_<group>_<name>` aliases only at the provider boundary,
including tool definitions, choice, historical calls/results and streamed calls.
Every SDK-facing name, contract, persisted message, approval hash and HMAC retains
the PRD dotted name. No provider alias enters the protocol.

All 37 PRD tools have input/output schemas and locations. Each implementation
group owns one file so later WPs replace groups without registry changes.
`package.build` belongs to the form group. Client tools have no `execute`.
Unbuilt tools throw `ToolNotImplementedError` with the stub flag absent; explicit
`BRAIN_ALLOW_STUBS=1` returns contract-validated build fixtures. Unit tests exercise
every stub with both flag states. Fixture content is confined to that branch.

The full benefit transport record preserves the PRD section 10 fields. Knowledge
remains responsible for validating catalog expressions and references. Brain
cannot import knowledge while its legacy dependency points back to brain;
transport schemas therefore have no knowledge runtime dependency. Form field
names follow the existing detector/catalog conventions (`label_de`, `acro_field`,
`fact_type`, `method`).

`drizzle-orm@^0.45.4` is added as a direct dependency, at the repository's existing
version, because the real tool and approval implementations construct queries
against `@lotse/db`. `@lotse/db` was already a workspace dependency. There are no
new services or other dependencies.

## Server authority and persistence

New cases use the session user's `self` subject. A user row lock serializes
creation of that subject. Every turn verifies the live session and case actor,
then locks the case while merging the latest message and claiming a running turn.
Overlapping requests are rejected. A five-minute lease permits recovery of a
crashed running turn; model calls have a four-minute total and one-minute step
limit. There is no transaction open across a provider stream.

Every checkpoint and final save reacquires that case lock and checks that its turn
is still running. A takeover marks the old claim interrupted under the same lock;
the old process then receives `TURN_SUPERSEDED` before any message or status write.
Final message persistence and the final turn status commit in one transaction.

Autonomy resolves through case → subject → the self subject's creator's profile,
never the current helper's profile. A missing profile (including a subject with
no corresponding self user) yields L1. This implements the M0 profile-level
storage deviation without changing the schema. L1 removes approval tools and
`form.fillLive`; helper actors cannot approve or perform case/reminder writes.

A helper must have `shareScope.case === true` to access conversation history.
`shareScope.facts === true` permits the subject's requested fact types; a string
array permits only those types. Missing scope denies fact access. Fact reads
always bind the stored subject id, regardless of model input. Owners can read
their subject's requested facts. These keys describe the current JSON scope
representation; the future relatives UI must produce this representation.

For conversation access, a helper also needs `shareScope.facts === true` until
an authorized history projection exists. Restricting new queries cannot remove
facts already present in owner tool results or repeated in plain text. Denying
restricted helper turns is the conservative M0 behavior; scoped direct fact reads
still enforce the fact-type list. No historical messages are exposed to a model
or streamed to a restricted helper.

The SDK UI `onStepEnd` saves its message snapshot. The agent's `onStepEnd` waits
for that database checkpoint, so the next model step cannot overtake persistence.
A test queries Postgres inside the second model invocation and observes the
first tool's completed output. Final snapshots and turn state are persisted on
end, failure or abort. Messages and approvals are sufficient to reconstruct a
pending turn in a fresh agent instance.

Approved server tools execute in the SDK's initial continuation phase without a
UI `finish-step`. Their `onToolExecutionEnd` callback serializes and awaits result
checkpoints, including fixed-code errors, before the next model invocation. The
installed SDK awaits lifecycle callbacks but suppresses their exceptions
(`src/util/notify.ts`); the agent therefore retains checkpoint failure and throws
it from `prepareStep`. A failed save cannot silently allow model continuation.

On expired running-turn takeover, failed/interrupted turns, or an expired client
wait, recovery reconciles stored unfinished calls against consumed approval rows.
An uncertain approved call becomes `output-error` with `TOOL_INTERRUPTED`, whether
execution/dispatch occurred or not. Its approval stays consumed; the next fresh
user message can continue the case, and retries require a new tool call with new
approval. Replayed approval decisions and late results cannot change that error.
Unconsumed pending approval requests survive unchanged. This deliberately avoids
claiming exactly-once execution across an unacknowledged client dispatch.

## Approval design and OT-12

Inputs use RFC 8785 canonical JSON (`canonicalize`) and SHA-256. Invalid JSON
numbers and unpaired Unicode surrogates are rejected. The record HMAC-SHA256
covers a canonical object containing approval id, tool call id, dotted tool name
and input hash. Comparison is constant-time. SDK signing with
`experimental_toolApprovalSecret` is enabled in addition to this record.

Issuance saves a pending approval and opaque audit event before emitting the SDK
request and `data-approval-context`. The message checkpoint persists its
`approval-requested` part and context at step completion. On continuation, one
transaction locks the pending row, checks case/call/name/input hash/HMAC,
session expiry and identity, subject actor role, current autonomy and unchanged
SDK approval signature, then sets the decision and consumes an approved row.
The decision, consumption and updated UI message commit together. A denial is
recorded without consumption. Only the stored tool input reaches execution.

**OT-12 passed against real Postgres and the real SDK chat implementation.**
Stock UI handling calls `onToolCall` on `tool-input-available`, before a following
approval request, and does not redispatch an approved tool without `execute`.
The server therefore mediates that stream using standard SDK UI chunks:

1. For a gated client call, stream `tool-input-start` and `tool-input-delta` as a
   visible preview, then the SDK's signed approval request and approval context.
   Do not emit `tool-input-available` yet, so `onToolCall` cannot execute early.
2. `addToolApprovalResponse` triggers the approval predicate. After the database
   transaction verifies and consumes it, stream `tool-input-available` for that
   stored call. Do not invoke the model while its client output is outstanding.
   Persist the already-approved state rather than a transient input state.
3. `onToolCall` runs once; `addToolOutput` triggers the completion predicate.
   Validate the output against the stored tool's schema, merge it into the
   server message and resume the agent loop.

The integration test uses `AbstractChat`, `DefaultChatTransport`, both auto-send
predicates and `MockLanguageModelV4`. The model and test UI state are test-only;
persistence, HMAC, approval consumption and stream processing are real. It asserts
zero client executions before approval, one after consumption and exactly three
requests through the completed answer. Rejection tests cover changed input,
replayed/concurrent approvals, another session, forged/injected parts, missing or
invalid SDK signatures and missing or invalid database HMACs.

## Verification

The runtime unit suite compares registry names to the actual PRD table and checks
all stub fixtures, display/client contracts, canonicalization, config and model
routing. Integration uses disposable real Postgres databases and preserves the
existing database/MinIO integration suite. The live route test uses a signed
session cookie and real OpenAI model, checks a German streamed answer and verifies
its messages and completed turn in Postgres. `test:live` retains the existing form
vision test and also discovers the runtime live test. No live/integration test
silently skips a missing dependency.

### Final verification (2026-11-06)

The restored shared Compose project passes
`COMPOSE_PROJECT_NAME=lotse docker compose up -d --wait`; migration also passes.
The real database/MinIO integration suite passes all 42 tests, followed by all
27 runtime integration tests, including OT-12 and every approval rejection case.
Both live tests pass against OpenAI: the authenticated German turn is streamed
and persisted, and the existing form vision test remains green.

Brain typechecking and all 69 offline brain tests pass. The production web build
includes `/api/turn` and passes the client secret scan. Repository verification
passes all 16 tasks, including E2 with its exact-path stub-flag
exceptions. Formatting and whitespace checks pass.

Six new real-Postgres regression cases cover restricted helper history containing
an owner's unshared fact, an expired writer resuming after takeover, approved
server tool success and failure persistence before model continuation, a crash
between approval consumption and client dispatch, and preservation of an
unconsumed pending approval across takeover. The crash recovery case also checks
fresh approval issuance, no redispatch, and rejection of the old approval.
