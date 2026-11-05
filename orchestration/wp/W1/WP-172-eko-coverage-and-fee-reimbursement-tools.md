---
id: WP-172
title: EKO coverage and fee reimbursement tools
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-006, WP-014, WP-153, WP-154]
fr: [FR-M1, FR-M2]
owns:
  - packages/brain/src/tools/impl/eko/**
  - packages/brain/src/tools/impl/fees/**
  - packages/brain/test/eko/**
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
pr_title: "feat(brain): add eko coverage and fee reimbursement tools"
---

# WP-172: EKO coverage and fee reimbursement tools

## Goal and deliverables

Wrap the WP-154 EKO loader as `eko.lookupCoverage` and the WP-153 fee loader as
`fees.explainReimbursement`, with their WP-006 contracts. ATC codes and indication texts never reach
the model; amounts are labelled illustrative with region and as-of date.

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

- [ ] AC1: Tool outputs validate against the contracts and never contain ATC or indication text (test).

## Suggested commits

- `feat(brain): add eko coverage and fee reimbursement tools`
