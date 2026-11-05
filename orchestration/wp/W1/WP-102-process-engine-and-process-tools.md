---
id: WP-102
title: Process engine and process tools
wave: W1
lane: engine
risk: normal
codex_effort: high
depends_on: [WP-006, WP-014]
fr: [FR-G3, FR-G7, FR-K5, E1]
owns:
  - packages/brain/src/engine/**
  - packages/brain/src/tools/impl/process/**
  - packages/brain/test/engine/**
may_touch:
  - packages/brain/package.json
  - bun.lock
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
pr_title: "feat(engine): add process engine and process tools"
---

# WP-102: Process engine and process tools

## Goal and deliverables

Implement the pure-TypeScript process engine of PRD §8 "Process engine" (no LLM inside) and the
`process.start`, `process.nextStep`, `process.applyAnswers`, `process.completeStep` tools. Slots fill
from context facts (`from_context`, read through the single fact store scoped to subject and share
scope) or answers; `needs` resolves slots and steps; criteria conditions are evaluated with the
condition grammar from `@lotse/knowledge` (implement the evaluator here; unknown when a slot is
missing); the next question is the missing slot that unlocks the most remaining steps (FR-G3), never
asked twice; `completeStep` creates the next `case_step` rows, reminders and prepared artefacts per
`on_complete` (FR-K5). State persists in `case`/`case_step`. E1 is these unit tests at 100%.

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

- [ ] AC1: E1: every step, criteria outcome (met, not met, unknown) and transition of a fixture process
  is covered by unit tests without an LLM.
- [ ] AC2: No slot is asked twice; the next question maximizes unlocked steps (test with a branching fixture).
- [ ] AC3: `process.completeStep` creates the next steps and reminders in real Postgres.
- [ ] AC4: Tools validate input and output with their WP-006 contracts.

## Suggested commits

- `feat(engine): add process engine and process tools`
