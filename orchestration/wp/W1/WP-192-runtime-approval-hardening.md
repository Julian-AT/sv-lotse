---
id: WP-192
title: Runtime, history and approval hardening
wave: W1
lane: approvals
risk: high
codex_effort: xhigh
depends_on: [WP-006]
fr: [FR-A1, FR-A2, FR-P7, NFR-4]
owns:
  - packages/brain/src/tools/impl/context/**
  - packages/brain/src/tools/impl/reminder/**
  - packages/brain/src/tools/registry.ts
  - packages/brain/src/tools/types.ts
  - packages/brain/src/conversation/**
  - packages/brain/src/agent/**
  - packages/brain/src/approvals/**
  - packages/brain/test/runtime/**
may_touch:
  - bun.lock
allow_deps: none
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/db db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - bun run --filter @lotse/brain test:integration
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live
pr_title: "fix(approvals): harden history, approval persistence and helper scope"
---

# WP-192: Runtime, history and approval hardening

## Goal

WP-006 landed under deadline mode with five majors from its cross-review. Fix all of them with the
regression tests they name before the turn pipeline (WP-106) and the demo use the runtime.

## Findings to fix (from the WP-006 cross-review)

1. **major — Historical facts bypass helper scope.** [conversation/index.ts:195](packages/brain/src/conversation/index.ts:195)  
   The agent receives the entire case history, including earlier `context.queryFacts` results outside the helper’s current `shareScope.facts`. Filtering new fact queries does not protect those historical values. A focused check confirmed an excluded fact reaches the helper’s model prompt. **Required change:** construct an authorized history projection before model invocation, or deny restricted helper access until that projection exists. Add a regression covering owner history containing an unshared fact.

2. **major — Expired turn writers can overwrite newer history.** [conversation/index.ts:111](packages/brain/src/conversation/index.ts:111)  
   `claimTurn` permits takeover after five minutes, but subsequent checkpoints and final saves never verify that their turn still owns the case. An older process resuming after a stalled checkpoint or process pause can overwrite the replacement turn’s messages through positional upserts. **Required change:** acquire the case lock and verify the current turn claim inside every checkpoint/finalization transaction; reject stale writers before changing messages or status. Test takeover followed by a delayed old save.

3. **major — Approved server results bypass the persistence barrier.** [agent/index.ts:43](packages/brain/src/agent/index.ts:43)  
   The SDK executes approved server tools during its initial approval-continuation phase, without a `finish-step` boundary. Consequently, the UI step checkpoint does not persist that result before the next model call. A focused SDK check observed zero checkpoint callbacks before that call. A crash leaves a consumed approval with an outdated `approval-responded` message, violating NFR-4. **Required change:** persist and await approved server-tool results, including errors, before allowing the next model invocation. Extend the persistence integration test to this continuation path.

4. **major — A crash before client dispatch permanently strands a consumed approval.** [conversation/history.ts:169](packages/brain/src/conversation/history.ts:169)  
   Approval consumption and `approval-responded` persistence commit before `ui.fill` is dispatched. If the process dies between those operations, retrying the stored message fails because nothing changed; a new user message also fails because the call remains outstanding. The case cannot recover even after lease expiry. **Required change:** reconcile unfinished consumed calls from server state during interrupted-turn recovery. Safely resolve uncertain calls to an explicit interrupted/error state and require fresh approval for retries, preserving replay rejection. Add a crash-between-commit-and-dispatch test.

## Follow-ups

5. **major — Switching to L1 prevents rejecting an outstanding approval.** [conversation/history.ts:76](packages/brain/src/conversation/history.ts:76), [approvals/index.ts:90](packages/brain/src/approvals/index.ts:90)  
   Both checks reject a negative approval response after autonomy changes to L1. New user messages are also rejected while that approval remains pending, leaving the conversation stuck until autonomy is raised again. **Required change:** allow the authorized subject to deny pending approvals independently of execution permission; retain L1 restrictions for affirmative decisions. Test downgrade, denial, and a subsequent user turn.

Verification: brain typecheck and all 34 runtime unit tests passed. Database, live-provider, and build gates were not run during this read-only review.

## More findings (from the WP-006 attempt-4 cross-review)

Some attempt-3 findings may already be fixed on main; verify each and fix what remains.

1. **major — Failed checkpoints do not stop the agent loop.**  
   [packages/brain/src/agent/index.ts:57](packages/brain/src/agent/index.ts:57)

   The SDK swallows exceptions from `onStepEnd`, but this callback does not set `persistenceFailure`. A reproduction with a rejecting checkpoint still made two model calls and finished normally. Further tools can therefore execute after persistence fails, violating NFR-4.

   **Required change:** Catch checkpoint failures, retain them in the failure state checked by `prepareStep`, and stop continuation. Add a regression asserting no second model call or subsequent tool execution.

2. **major — Superseded turns can still mutate application data.**  
   [packages/brain/src/tools/impl/case/index.ts:12](packages/brain/src/tools/impl/case/index.ts:12), [reminder/index.ts:10](packages/brain/src/tools/impl/reminder/index.ts:10)

   `lockTurnClaim` protects message checkpoints, but these mutations check only the captured case and actor context. An expired writer resuming after takeover can still update the case or insert reminders; rejecting its later checkpoint cannot undo those writes. Model timeouts do not cancel pending Postgres operations.

   **Required change:** Carry the turn claim into tool execution and perform each mutation inside a transaction that locks the case and verifies the claim remains running. Extend the takeover regression to assert that the superseded writer cannot mutate either table.

3. **major — Recovery permanently strands some interrupted conversations.**  
   [packages/brain/src/conversation/recovery.ts:26](packages/brain/src/conversation/recovery.ts:26)

   Recovery handles only consumed, approved calls. If the process crashes after committing a rejection, the stored part remains `approval-responded` with `approved: false`. Recovery leaves it unchanged, while `mergeLatest` rejects both a fresh user message and the unchanged rejection. Unfinished ungated server calls left `input-available` have the same problem. This breaks FR-C9/NFR-4.

   **Required change:** Recover committed denials as `output-denied` and uncertain unfinished ungated calls as terminal interruption errors, preserving genuinely pending approvals. Add crash-recovery tests for both cases.

4. **major — Approval requests reach the client before their complete state is durable.**  
   [packages/brain/src/conversation/index.ts:259](packages/brain/src/conversation/index.ts:259)

   Issuance commits the approval row and immediately emits the request/context. The signed UI tool part is persisted only at step completion. A crash between emission and that checkpoint leaves a pending row without the stored input and signed message needed to resume it. The client’s response is then rejected because server-owned history lacks the call.

   **Required change:** Atomically persist the approval row, signed tool part and approval context under the current turn claim before emitting them. Add a real-Postgres regression interrupting issuance before `finish-step`.

## Follow-ups

5. **minor — Real tool operations omit required append-only audit events.**  
   [packages/brain/src/tools/registry.ts:65](packages/brain/src/tools/registry.ts:65)

   Only approval issuance and decisions write `auditEvents`. Fact reads and case/reminder mutations lack the tool audit events required by PRD §13, leaving access and changes absent from that audit trail.

   **Required change:** Record opaque actor, case and tool-call identifiers with operation/outcome names; keep user values out. Commit mutation audit events transactionally with their writes and verify them in integration tests.

## Scope note (2026-11-06)

Audit events for the `case` tool group are WP-V1's (it owns `tools/impl/case`); fix the other findings.

## Acceptance criteria

- [ ] AC1: Each finding is fixed and proven by its regression test against real Postgres.
- [ ] AC2: All WP-006 tests stay green; all gates pass.

## Suggested commits

- `fix(approvals): harden history, approval persistence and helper scope`
