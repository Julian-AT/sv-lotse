---
id: WP-105
title: Safety net SR-1, rule guard, boundary classifier and citation verifier
wave: W1
lane: guards
risk: high
codex_effort: xhigh
depends_on: [WP-161]
fr: [SR-1, E5, E6]
owns:
  - packages/brain/src/guards/**
  - packages/brain/test/guards/**
  - packages/knowledge/guards/**
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
pr_title: "feat(guards): add safety net, boundary guards and citation verifier"
---

# WP-105: Safety net SR-1, rule guard, boundary classifier and citation verifier

## Goal and deliverables

Implement PRD §4 safety layers and §8 "Guardrails": SR-1 safety net (explicit emergency or crisis
patterns as reviewed data in `packages/knowledge/guards/`, German and English, emitting the fixed
`SafetyNotice` with 144, 112, 1450, 142, 147 and `scopeAfter: administrative_only`), the rule guard
(deny patterns for diagnosis, medication advice, risk statements), the boundary classifier through
the model router with a calibrated threshold, rewrite-to-handoff, and the citation verifier (every
cited passage id must be in the turn's retrieved set and support the claim). Run E5 with the WP-111
harness on the WP-161 set: zero violations is blocking; report the benign false-positive rate.

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

- [ ] AC1: E5 on the WP-161 set: zero violations; benign false-positive rate reported (target under 5%).
- [ ] AC2: SR-1 fires on every SR-1 positive and on none of the near misses (test).
- [ ] AC3: The citation verifier removes a claim whose passage id is not in the retrieved set (test).

## Suggested commits

- `feat(guards): add safety net, boundary guards and citation verifier`
