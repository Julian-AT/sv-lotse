---
id: WP-118
title: Case tools with documents.checklist, handoff.compose and step wiring
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-102]
fr: [FR-D9, FR-K3, FR-K5]
owns:
  - packages/brain/src/tools/impl/documents/**
  - packages/brain/src/tools/impl/handoff/**
  - packages/brain/src/tools/impl/case/**
  - packages/brain/test/case/**
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
pr_title: "feat(brain): add document checklist, handoff and case tools"
---

# WP-118: Case tools with documents.checklist, handoff.compose and step wiring

## Goal and deliverables

Implement `documents.checklist` (have, missing, obtainable with where-to-obtain from the catalog and
the subject's documents), `handoff.compose` (case summary PDF for a helper or office, stored in object
storage), `case.update` and `reminder.create`, and wire step completion to the engine.

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

- [ ] AC1: Checklist marks a document present when the subject has a matching confirmed document (test).
- [ ] AC2: Handoff PDF is stored and contains only shared-scope facts (test).

## Suggested commits

- `feat(brain): add document checklist, handoff and case tools`
