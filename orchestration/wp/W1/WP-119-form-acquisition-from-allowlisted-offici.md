---
id: WP-119
title: Form acquisition from allowlisted official sites
wave: W1
lane: forms
risk: normal
codex_effort: high
depends_on: [SUPERSEDED-BY-VERTICAL-SLICES]
fr: [FR-D10]
owns:
  - packages/brain/src/forms/acquire/**
  - packages/brain/test/forms/acquire/**
  - packages/knowledge/forms/sources.yaml
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
pr_title: "feat(forms): find and acquire official forms from allowlisted sites"
---

> Superseded on 2026-11-06 by the W2 vertical slices (WP-V1 to WP-V7).

# WP-119: Form acquisition from allowlisted official sites

## Goal and deliverables

Implement `form.find` (catalog form hints, registered templates, then allowlisted publisher pages from
`packages/knowledge/forms/sources.yaml`) and `form.acquire` (download from an allowlisted origin only,
nothing behind a login, store the original, register a versioned `form_template` with source URL, hash
and retrieval date, status `auto`, and run WP-120 detection for flat PDFs); re-check known templates
for newer versions before use.

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



## Deadline mode: build the core now, register tools in WP-180 (decision 2026-11-06)

WP-006 (agent runtime, tool contracts, registry, approvals, model router) is still running. Do not
wait for it and do not touch `packages/brain/src/tools/**`, `src/agent/**`, `src/approvals/**` or
`src/models/**`:

- Implement the logic as a typed module in your owned area with a small public API (pure functions or
  a service taking its dependencies as parameters: database client, model, clock). Export it from a
  subpath export of `@lotse/brain` (for example `./engine`), added to `packages/brain/package.json`.
- Define the tool input and output shapes you need as Zod schemas in your module, named after the PRD
  §8 tool (for example `ProcessNextStepInput`). WP-180 maps them onto the WP-006 contracts and
  registers the tools; keep them faithful to the PRD §8 table.
- Models: accept an AI SDK `LanguageModel` / `EmbeddingModel` parameter; for live tests create it
  with `@ai-sdk/openai` from an environment variable with a documented default. WP-180 switches to
  the model router.
- Approval-gated operations (for example `form.commitGroup`) take a verified approval as a parameter
  (`{ approvalId, inputHash }`) and must call `consumeApproval` from `@lotse/db/approvals`; WP-180
  wires the HMAC verification from WP-006.

## Context

- PRD sections for the requirement IDs above (§8 agent design and tools, §10 data, §14 evaluation,
  §4 boundaries); `AGENTS.md` at the root and in the packages you touch.

## Acceptance criteria

Each criterion is proven by a named test or gate against real services.

- [ ] AC1: Acquiring a real allowlisted form registers a template with hash and source (live).
- [ ] AC2: A non-allowlisted URL and a redirect to one are refused (test).

## Suggested commits

- `feat(forms): find and acquire official forms from allowlisted sites`
