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

## Acceptance criteria

- [ ] AC1: Each finding is fixed and proven by its regression test against real Postgres.
- [ ] AC2: All WP-006 tests stay green; all gates pass.

## Suggested commits

- `fix(approvals): harden history, approval persistence and helper scope`
