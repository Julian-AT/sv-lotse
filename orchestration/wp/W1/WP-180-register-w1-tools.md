---
id: WP-180
title: Register the W1 tool groups on the agent runtime
wave: W1
lane: brain
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-102, WP-104, WP-105, WP-107, WP-115, WP-116, WP-117, WP-118, WP-172]
fr: [FR-A1, FR-A2, NFR-17]
owns:
  - packages/brain/src/tools/impl/**
  - packages/brain/test/tools/**
may_touch:
  - packages/brain/src/models/**
  - bun.lock
allow_deps: none
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live
pr_title: "feat(brain): register w1 tool groups on the agent runtime"
---

# WP-180: Register the W1 tool groups on the agent runtime

## Goal

The W1 core WPs built their logic as modules with their own Zod input and output shapes while WP-006
built the runtime, contracts, registry, approvals and model router. Replace each stub group in
`packages/brain/src/tools/impl/<group>/` with a real implementation that calls the module, mapping onto the
WP-006 contracts, and remove the stub branches (NFR-17).

## Deliverables

1. One implementation folder per group: process, kb, docs, form, office, facility, appointment,
   documents, handoff, case, eko, fees. Validate input and output with the WP-006 contracts; where a
   module's shape differs from the contract, adapt in the implementation, never change the contract.
2. Models through the WP-006 model router (roles from PRD §8) instead of module defaults.
3. Approval-gated tools (`form.commitGroup` and any other the contracts mark) verify the approval
   record, HMAC and input hash through WP-006 before calling the module.
4. Guards (WP-105) and the safety net are wired where WP-006 left hooks; the turn pipeline itself is
   WP-106.
5. A test enumerates every PRD §8 server tool and asserts none uses a stub with `BRAIN_ALLOW_STUBS`
   unset, except groups whose module does not exist yet (list them explicitly).

## Acceptance criteria

- [ ] AC1: Each registered group round-trips one call through the registry against real Postgres
  (live where the module needs a model).
- [ ] AC2: `form.commitGroup` rejects a changed input, a replayed approval and a missing HMAC.
- [ ] AC3: The stub test passes.

## Suggested commits

- `feat(brain): register w1 tool groups on the agent runtime`
