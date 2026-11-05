---
id: WP-106
title: Turn pipeline, context assembly, segmenter and goal confirmation
wave: W1
lane: pipeline
risk: high
codex_effort: xhigh
depends_on: [WP-102, WP-104, WP-105, WP-180]
fr: [FR-G7, NFR-1]
owns:
  - packages/brain/src/pipeline/**
  - packages/brain/src/context/**
  - packages/brain/test/pipeline/**
may_touch:
  - packages/brain/package.json
  - bun.lock
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live
pr_title: "feat(pipeline): add turn pipeline with context assembly and segmenter"
---

# WP-106: Turn pipeline, context assembly, segmenter and goal confirmation

## Goal and deliverables

Implement the PRD §8 turn pipeline steps 1–8 around the WP-006 runtime: normalize, SR-1 safety net,
classify, goal confirmation (FR-G7), context assembly with the §8 budget table (facts only for the
active step, read from the store), the agent loop with the engine's next-step hint in `prepareStep`,
guards, segmentation into `SpeechSegment` and `Action` data parts bound to sentence indices, and
persistence after every step. Measure latency against NFR-1 in the live test.

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


## Context

- PRD sections for the requirement IDs above (§8 agent design and tools, §10 data, §14 evaluation,
  §4 boundaries); `AGENTS.md` at the root and in the packages you touch.

## Acceptance criteria

Each criterion is proven by a named test or gate against real services.

- [ ] AC1: A live scenario-3 turn streams segments with citations and a goal-confirmation question first.
- [ ] AC2: SR-1 input yields the SafetyNotice before any other output (test).
- [ ] AC3: Context assembly respects the budget shares (unit test).

## Suggested commits

- `feat(pipeline): add turn pipeline with context assembly and segmenter`
