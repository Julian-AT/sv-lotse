---
id: WP-115
title: Form engine core with registry, prefill, drafts, commit and package build
wave: W1
lane: forms
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-014, WP-168]
fr: [FR-D5, FR-D6, E7]
owns:
  - packages/brain/src/forms/registry/**
  - packages/brain/src/forms/instances/**
  - packages/brain/src/forms/output/**
  - packages/brain/src/tools/impl/form/**
  - packages/brain/test/forms/core/**
  - apps/web/src/app/api/forms/**
may_touch:
  - packages/brain/package.json
  - bun.lock
  - apps/web/package.json
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - RUN_LIVE=1 bun run --filter @lotse/brain test:live
pr_title: "feat(forms): add form registry, prefill, commits and package build"
---

# WP-115: Form engine core with registry, prefill, drafts, commit and package build

## Goal and deliverables

Implement `form.getSchema`, `form.prefill` (field proposals with provenance from confirmed facts;
missing fields listed; doctor, hospital and office sections never filled; IBAN only from the user's
own statement), draft `form_instance` values, `form.commitGroup` behind server-side approvals (approval
record, HMAC and input hash verified before execution, FR-A2), and `package.build` with pdf-lib
(AcroForm fill; for flat PDFs add detected fields from WP-120 output and fill them; drawn text as
fallback; confirmed values only). `/api/forms` routes without logic. Run E7 on the WP-165 set when it
exists (report numbers or `not_run`).

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

- [ ] AC1: Prefill of an SV-Box form from confirmed facts yields provenance per value and leaves
  non-applicant sections empty (test against real Postgres).
- [ ] AC2: `form.commitGroup` rejects a changed input, a replayed approval and a missing HMAC (tests).
- [ ] AC3: `package.build` produces a PDF whose fields contain exactly the confirmed values (test reads it back).

## Suggested commits

- `feat(forms): add form registry, prefill, commits and package build`
