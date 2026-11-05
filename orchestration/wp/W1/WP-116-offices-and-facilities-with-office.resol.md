---
id: WP-116
title: Offices and facilities with office.resolve and facility.search
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-006, WP-014, WP-155, WP-156]
fr: [FR-O1, FR-O2]
owns:
  - packages/brain/src/tools/impl/office/**
  - packages/brain/src/tools/impl/facility/**
  - packages/brain/src/geo/**
  - packages/brain/test/geo/**
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
pr_title: "feat(brain): add office resolution and facility search"
---

# WP-116: Offices and facilities with office.resolve and facility.search

## Goal and deliverables

Implement `office.resolve` (apply the benefit's `office_rules` conditions to subject status, carrier
and region, then look up the office directory loaded from WP-155 and WP-156) and `facility.search`
(distance from coordinates or a place; place lookup through a bundled Austrian postal-code and
municipality table from an official open dataset, documented with its source and licence, so no
geocoding service is needed).

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

- [ ] AC1: For scenario-3 inputs (ÖGK, pensioner, Styria) `office.resolve` returns the responsible office
  from the directory (test against real Postgres with the loaded catalog).
- [ ] AC2: `facility.search` sorts by distance from a postal code (test).

## Suggested commits

- `feat(brain): add office resolution and facility search`
