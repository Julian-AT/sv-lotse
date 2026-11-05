---
id: WP-006
title: Brain runtime, tool contracts, server-side approvals and the turn route
wave: W0
lane: brain
risk: high
codex_effort: xhigh
depends_on: [WP-003, WP-005, WP-013]
fr: [FR-A1, FR-A2, FR-C9, FR-P1, FR-P7, NFR-4, NFR-17]
owns:
  - packages/brain/src/index.ts
  - packages/brain/src/agent/**
  - packages/brain/src/tools/**
  - packages/brain/src/approvals/**
  - packages/brain/src/conversation/**
  - packages/brain/src/models/**
  - packages/brain/src/config/**
  - packages/brain/test/runtime/**
  - apps/web/src/app/api/turn/**
  - docs/adr/0006-agent-runtime-and-approvals.md
may_touch:
  - packages/brain/AGENTS.md
  - apps/web/AGENTS.md
  - packages/brain/package.json
  - packages/brain/vitest.config.ts
  - bun.lock
allow_deps: none beyond the baseline unless justified in the ADR
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - bun run --filter @lotse/brain test:integration
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live
  - bun run --filter @lotse/web build
pr_title: "feat(brain): add agent runtime, tool contracts and approvals"
---

# WP-006: Brain runtime, tool contracts, server-side approvals and the turn route

## Goal

A real conversation turn works end to end on the server:

- `/api/turn` streams an AI SDK 7 UI message stream from a `ToolLoopAgent`;
- the conversation history is owned by the server;
- every tool of PRD §8 has its contract;
- approval-gated tools go through the AI SDK's approval parts, backed by our server-side approval
  record.

Later waves implement the tools; this WP fixes their shape.

## Context

- PRD §8: agent runtime table, turn pipeline, tools table, guardrails.
- PRD §9: data parts, `ApprovalContext`.
- PRD §13: approval records, server-owned history.
- FR-A1 (tool permissions from the stored autonomy level), FR-A2 (approval records), NFR-17 (stubs
  only behind `BRAIN_ALLOW_STUBS`).
- Contracts from WP-003 (`@lotse/protocol`) and tables from WP-004.
- Read the current AI SDK 7 documentation:
  - ToolLoopAgent, `toolApproval`, `experimental_toolApprovalSecret`;
  - `prepareStep`, `contextSchema`, `toolsContext` and `runtimeContext`;
  - agent UI stream responses, `createUIMessageStream` writers for data parts;
  - tool approvals in AI SDK UI.

  Record the exact API names you used in the ADR.

## Deliverables

1. **Configuration.** `src/config/`: Zod-validated brain configuration (model roles, the approval
   secret, the stub flag).
2. **Model router.** `src/models/`:
   - roles `orchestrator`, `classifier`, `guard`, `extractor`, `embedding`;
   - each role has an OpenAI model and an optional fallback, configured by `OPENAI_MODEL_*`
     environment variables with sensible defaults; the variables are optional overrides and stay
     out of `.env.example`;
   - a typed `modelFor(role)`.
3. **Tool contracts.** `src/tools/contracts/`: a Zod input and output schema for every tool in the PRD
   §8 tools table, with its run location (server, display, client) and its approval flag.
   - `src/tools/registry.ts` builds the AI SDK tool set from the contracts plus implementations.
   - Implementations live in `src/tools/impl/<group>/index.ts`, one folder per group:
     `catalog`, `process`, `kb`, `office`, `facility`, `appointment`, `form`, `documents`, `docs`,
     `eko`, `fees`, `case`, `reminder`, `handoff`, `context`, `ui`, `form-live`.
     The form tools (`form.find`, `form.acquire`, `form.analyze`, `form.getSchema`, `form.prefill`,
     `form.fillLive`, `form.commitGroup`) are contracts and stubs here; W1 implements them.
     Later WPs replace a group's file without touching the registry.
4. **Real implementations now.**
   - Display tools `ui.point`, `ui.highlight`, `ui.annotate`, `ui.caption` and `ui.openResource` emit
     a `data-action` part bound to the current sentence index and return `{ actionId }`.
   - Client tools (`ui.fill`, `context.readScreen`, `context.readPage`, `calendar.createEvent`,
     `session.shareWithHelper`) have no `execute`.
   - `context.queryFacts` reads facts by subject and share scope from Postgres.
   - `case.update` and `reminder.create` write to Postgres.
5. **All other server tools** are stubs. They throw a typed `ToolNotImplementedError` unless
   `BRAIN_ALLOW_STUBS=1`; with the flag, they return schema-valid fixture data. A test asserts that the
   stub branch is unreachable with the flag unset.
6. **Agent.** `src/agent/`: a `ToolLoopAgent` factory.
   - `prepareStep` filters tools by the case's stored autonomy level and the actor role:
     - L1 removes approval-gated tools;
     - L2 and L3 keep them behind approval.
   - It carries a minimal versioned policy prefix stating the medical and action boundaries of PRD §4.
     The full guard pipeline arrives in W1.
   - `runtimeContext` and `toolsContext` carry case id, subject id, actor role and autonomy level.
7. **Approvals.** `src/approvals/`:
   - canonical JSON (RFC 8785) and SHA-256 input hash;
   - an HMAC over approval id, tool call id, tool name and input hash with `APPROVAL_HMAC_SECRET`;
   - on an approval request: write the pending `approval` row and emit `data-approval-context`;
   - on continuation, inside a transaction, verify session, actor, input hash and HMAC, then consume
     the approval exactly once;
   - additionally configure `experimental_toolApprovalSecret`.
8. **Conversation.** `src/conversation/`:
   - load the case's persisted UI messages;
   - accept only the latest message from the client and ignore any client-supplied history;
   - persist new messages after every step;
   - create a case for the `self` subject when `caseId` is missing;
   - check that the session user is an actor on the case.
9. **Route.** `apps/web/src/app/api/turn/route.ts` stays thin: `requireSession`, parse the
   `TurnRequest` from `@lotse/protocol`, call `handleTurn` from `@lotse/brain`, return the UI message
   stream response.
10. **ADR.** `docs/adr/0006-agent-runtime-and-approvals.md`: the APIs used, the approval design and the
    OT-12 result.

## Acceptance criteria

- [ ] AC1: Every tool name in PRD §8 has a contract and a registry entry. A test compares the names to
  the PRD list.
- [ ] AC2: With `BRAIN_ALLOW_STUBS` unset, calling a stubbed tool yields a tool error part in the stream,
  not a crash or fixture data.
- [ ] AC3: At L1 approval-gated tools are not offered to the model. At L2 a call to `ui.fill` produces
  all three of:
  - a `tool-approval-request` part;
  - a `data-approval-context` part;
  - a pending `approval` row.
- [ ] AC4: Rejection tests (integration, real Postgres). None of these executes the tool:
  - changed input after approval;
  - replayed approval;
  - approval from another session;
  - a forged approval part in the client message;
  - missing or invalid HMAC.
- [ ] AC5 (OT-12): An approved `ui.fill` leads to the client tool call. The client output arriving in
  the next request continues the loop, with `sendAutomaticallyWhen` semantics. Use the AI SDK test
  language model in the test file to force the tool call; the approval machinery under test is real.
- [ ] AC6: Server-owned history: messages the client sends beyond the latest one are ignored (test).
- [ ] AC7 (live): A real model turn through the route handler streams a German answer to a German
  question, and the turn is persisted.

## Notes for the implementer

- Autonomy level (decision 2026-11-05, recorded as a PRD deviation for M0): the schema stores it on
  `profile.autonomy_level`, not on `case`. Resolve it server-side from the profile of the case's
  subject (case -> subject -> profile, default `L1` when no profile exists). Never accept it from the
  client. No schema change.

- Database access goes through `@lotse/db` (WP-013), not `@lotse/brain/db`; add it as a
  `workspace:*` dependency.

## Suggested commits

- `feat(brain): add model router with role-based fallback chains`
- `feat(brain): add tool contracts and registry for all prd tools`
- `feat(approvals): add server-side approval records with hmac`
- `feat(brain): add tool loop agent with autonomy-based tool filtering`
- `feat(brain): add server-owned conversation persistence`
- `feat(web): add turn route streaming the agent ui message stream`
- `test(approvals): reject changed, replayed, foreign and forged approvals`
- `docs(adr): record agent runtime and approval design`
