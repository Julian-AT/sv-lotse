---
id: WP-107
title: Documents, server OCR, statement extraction and fact confirmation
wave: W1
lane: documents
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-005]
fr: [FR-D1, FR-D2, FR-D3, FR-P1, FR-P3, FR-P8, E12]
owns:
  - packages/brain/src/documents/**
  - packages/brain/src/tools/impl/docs/**
  - packages/brain/test/documents/**
  - apps/web/src/app/api/documents/**
  - apps/web/src/app/api/facts/**
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
pr_title: "feat(documents): add upload, ocr, statement extraction and fact api"
---

# WP-107: Documents, server OCR, statement extraction and fact confirmation

## Goal and deliverables

Implement document upload to object storage (encrypted at rest per PRD), page text from the PDF text
layer and, for scanned pages, OCR through the model router's vision model, stored as
`{ text, lines: [{ text, bbox }] }` pages; `docs.extractStatements` returning documented
recommendations and administrative facts as verbatim quotes with page and bbox (never interpreting
findings); and the `/api/documents` and `/api/facts` routes (route handlers without logic, calling the
brain; `requireSession`). Facts are proposals until the user confirms them (FR-P3). Run E12 with the
WP-111 harness on the WP-163 set and report precision and recall.

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

- [ ] AC1: Upload, OCR and extraction work end to end on the SV-Box discharge letter against real MinIO
  and OpenAI (live); every statement quote occurs in the page text.
- [ ] AC2: Facts stay unconfirmed until confirmed through `/api/facts` (test).
- [ ] AC3: E12 precision and recall are in the report; no extracted item interprets a finding.

## Suggested commits

- `feat(documents): add upload, ocr, statement extraction and fact api`
