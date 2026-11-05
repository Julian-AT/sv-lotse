---
id: WP-169
title: E13 gold set of flat official forms
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111]
fr: [E13, FR-D11]
owns:
  - packages/evals/sets/e13/**
  - packages/evals/test/sets/e13/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e13
pr_title: "test(evals): add e13 gold set of flat official forms"
---

# WP-169: E13 gold set of flat official forms

## Goal

Acquire 20 flat (non-fillable) official application forms from allowlisted carrier, ministry, federal state and FSW pages (PRD §10 source registry), store the PDFs with source URL, retrieval date and hash, and draw gold boxes per field: page, rectangle (PDF points), label, type and owner section. Check each form's licence or terms allow storage for testing; skip forms that do not.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary; requirement IDs above.
- Built on WP-101 (`packages/knowledge` schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation sets,
  WP-111 (`packages/evals` harness).
- Data-only W1b work package: many run in parallel, so stay strictly inside the owned paths.

## Data rules

- Use the case and suite schemas of the WP-111 harness (`packages/evals/src/schema/**`); add a small
  loader test under your `test/sets/<suite>/` folder that validates every item of the set and its
  size, so the gate proves the set is well-formed.
- Gold items reference their source passage (URL or SV-Box path plus quote or position); the leakage
  check (`packages/evals/src/checks/leakage.ts`) must pass against the catalog records that exist.
- Medical boundary (PRD §4): expected answers never contain a diagnosis, an interpretation of findings,
  a risk statement or medication advice.
- Synthetic personas and texts stay inside `packages/evals` and are labelled synthetic.

## Acceptance criteria

- [ ] AC1: 20 forms with source URL, hash and gold boxes for every field.
- [ ] AC2: The loader test validates boxes (inside the page, non-overlapping per field) and counts.
- [ ] AC3: Owner sections are labelled where the form has them.

## Suggested commits

- `test(evals): add e13 gold set of flat official forms`
