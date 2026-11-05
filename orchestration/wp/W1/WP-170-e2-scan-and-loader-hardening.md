---
id: WP-170
title: E2 scan and catalog loader hardening
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-101]
fr: [E2, NFR-17, FR-O3]
owns:
  - packages/knowledge/src/e2/**
  - packages/knowledge/src/loader/**
  - packages/knowledge/test/e2/**
  - packages/knowledge/test/loader/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: "a TypeScript tokenizer or parser for the scan (the `typescript` compiler API already in the repository is preferred)"
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
  - bun run --filter @lotse/knowledge e2:scan
pr_title: "fix(knowledge): harden e2 scan and catalog loader checks"
---

# WP-170: E2 scan and catalog loader hardening

## Goal

Close the gaps the WP-101 cross-review found (`.orchestration/runs/WP-101/attempt-2/xreview.md`), so
E2 and NFR-17 are enforced reliably before M1. E2 is a blocking gate at 100%.

## Deliverables

1. **Syntax-aware scanning.** Replace the hand-written tokenizer with the TypeScript compiler API
   (`ts.createScanner` or a full parse) for TS, TSX, JS and MJS, so division after `++`/`--`, regular
   expressions, template literals and JSX are handled. Regression tests for each, including
   `counter++ / "fixture-benefit".length`.
2. **Repository-wide stub check.** `BRAIN_ALLOW_STUBS` references are checked across all source and
   build configuration (including `next.config.*`, `apps/**`, `packages/**`, scripts), with exact-path
   exceptions only. A test places a reference outside the old roots and expects a failure.
3. **Allowlisted booking pages.** Before returning knowledge, every `appointment_channels` entry of
   kind `online` must have an origin in the loaded allowlist; failures name the benefit file and
   `appointment_channels.<index>.url`. Missing allowlist fails when any online channel exists.
4. **Form template ids in E2.** Every form's `template_id` joins the forbidden-id set; a scanner test
   with a template UUID literal fails.
5. **UUID comparison.** `catalog:load` compares template ids as UUIDs (`id = $1::uuid`); an
   integration test with an uppercase `template_id` updates the row.

## Acceptance criteria

- [ ] AC1–AC5: each deliverable proven by the named test; all gates pass.
- [ ] AC6: `e2:scan` still passes on the repository.

## Suggested commits

- `fix(knowledge): scan sources with the typescript scanner`
- `fix(knowledge): check stubs repository-wide and template ids in e2`
- `fix(knowledge): require allowlisted booking pages and compare uuids`
