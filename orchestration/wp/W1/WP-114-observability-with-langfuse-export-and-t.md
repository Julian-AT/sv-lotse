---
id: WP-114
title: Observability with Langfuse export and the PostHog event taxonomy
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-005]
fr: [NFR-12]
owns:
  - packages/brain/src/telemetry/**
  - packages/brain/test/telemetry/**
  - apps/web/src/analytics/**
may_touch:
  - packages/brain/package.json
  - bun.lock
  - apps/web/package.json
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
pr_title: "feat(brain): add tracing export and product analytics events"
---

# WP-114: Observability with Langfuse export and the PostHog event taxonomy

## Goal and deliverables

Implement PRD §15: trace attributes per turn and tool with no user content in logs (mask AI SDK
`gen_ai.*` message and tool attributes before export, as the WP-005 review required), cost and
latency per turn and case (NFR-12), Langfuse export only when keys are set, and the PostHog event
taxonomy from §15 in the web app, disabled when no key is configured. Typed event names; no personal
data in events.

## Rules that apply here

- Build on WP-006: tool contracts in `packages/brain/src/tools/contracts/`, the registry in
  `packages/brain/src/tools/registry.ts`, and one implementation folder per group in
  `packages/brain/src/tools/impl/<group>/index.ts`. Replace your group's stub implementation; do not edit the
  registry or other groups. Remove the stub branch for the tools you implement (NFR-17).
- The brain reads the catalog, processes, offices and form schemas from Postgres (loaded by
  `catalog:load`), validated with the `@lotse/knowledge` schemas; it never reads catalog YAML at
  runtime and never hard-codes a benefit, office or form id (E2 scan).
- Database access through `@lotse/db`. Zod at every boundary. Real Postgres and MinIO in tests;
  OpenAI where `live_services` lists it (model ids from the model router, never hard-coded).
- Medical boundary (PRD §4) in every prompt, string and fixture.


Also fix this finding from the last WP-005 cross-review (telemetry masking is this WP's area):

1. **major — Speech text bypasses telemetry redaction** — [apps/web/src/server/telemetry.ts:3](apps/web/src/server/telemetry.ts:3)

   `contentAttributes` omits `ai.request.text`, which AI SDK 7 emits for speech generation when input recording is enabled—the default. Langfuse’s configured mask does not cover this attribute. I reproduced a speech telemetry event passing its text unchanged through `redactSpanContent` into the exporter.

   This allows sensitive spoken content, including document excerpts or form values, to reach Langfuse despite the privacy filter. **Required change:** redact `ai.request.text` before delegation and add a speech telemetry regression test asserting that content is absent both before Langfuse processing and after export.

not_run: build, database/service, Playwright and container gates (read-only review).


## Deadline mode: build the core now, register tools in WP-180 (decision 2026-11-06)

WP-006 (agent runtime, tool contracts, registry, approvals, model router) is still running. Do not
wait for it and do not touch `packages/brain/src/tools/**`, `src/agent/**`, `src/approvals/**` or
`src/models/**`:

- Implement the logic as a typed module in your owned area with a small public API (pure functions or
  a service taking its dependencies as parameters: database client, model, clock). Export it from a
  subpath export of `@lotse/brain` (for example `./engine`), added to `packages/brain/package.json`.
- Define the tool input and output shapes you need as Zod schemas in your module, named after the PRD
  §8 tool (for example `ProcessNextStepInput`). WP-180 maps them onto the WP-006 contracts and
  registers the tools; keep them faithful to the PRD §8 table.
- Models: accept an AI SDK `LanguageModel` / `EmbeddingModel` parameter; for live tests create it
  with `@ai-sdk/openai` from an environment variable with a documented default. WP-180 switches to
  the model router.
- Approval-gated operations (for example `form.commitGroup`) take a verified approval as a parameter
  (`{ approvalId, inputHash }`) and must call `consumeApproval` from `@lotse/db/approvals`; WP-180
  wires the HMAC verification from WP-006.

## Context

- PRD sections for the requirement IDs above (§8 agent design and tools, §10 data, §14 evaluation,
  §4 boundaries); `AGENTS.md` at the root and in the packages you touch.

## Acceptance criteria

Each criterion is proven by a named test or gate against real services.

- [ ] AC1: A test exporter receives spans with masked content and per-turn cost and latency.
- [ ] AC2: Without keys nothing is exported and nothing fails.
- [ ] AC3: Event names match the §15 taxonomy (test enumerates them).

## Suggested commits

- `feat(brain): add tracing export and product analytics events`
