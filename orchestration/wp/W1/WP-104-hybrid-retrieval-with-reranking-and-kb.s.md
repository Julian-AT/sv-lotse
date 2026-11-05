---
id: WP-104
title: Hybrid retrieval with reranking and kb.search
wave: W1
lane: retrieval
risk: normal
codex_effort: high
depends_on: [WP-103, WP-014, WP-173, WP-174]
fr: [FR-G2, FR-G4, E3]
owns:
  - packages/brain/src/retrieval/**
  - packages/brain/test/retrieval/**
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
pr_title: "feat(retrieval): add hybrid search with reranking and kb.search"
---

# WP-104: Hybrid retrieval with reranking and kb.search

## Goal and deliverables

Implement PRD §10 "Retrieval": German full-text (`tsv`) and pgvector HNSW search over `kb_chunk`,
fused with reciprocal rank fusion, filtered by carrier, region and validity date (`asOf`), query
expansion with `packages/knowledge/synonyms.yaml` (read through the knowledge loader), and reranking.
The PRD names a multilingual cross-encoder; until E10 picks one, rerank through the model router with
an LLM listwise reranker behind a `Reranker` interface (no new paid service). `kb.search` returns
passages with ids, text, source URL and validity. Run E3 with the WP-111 harness on the WP-162 gold
set and record recall@10 and nDCG@10 in the report (informational).

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

- [ ] AC1: Hybrid search finds a known passage by keyword, by synonym and by paraphrase against real
  Postgres with real embeddings (live).
- [ ] AC2: Validity filtering excludes expired passages for `asOf` (test).
- [ ] AC3: E3 runs end to end and its numbers are in the report.

## Suggested commits

- `feat(retrieval): add hybrid search with reranking and kb.search`
