---
id: WP-165
title: E7 form prefill gold set from SV-Box forms
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111, WP-168]
fr: [E7, FR-D5]
owns:
  - packages/evals/sets/e7/**
  - packages/evals/test/sets/e7/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e7
pr_title: "test(evals): add e7 form prefill gold set"
---

# WP-165: E7 form prefill gold set from SV-Box forms

## Goal

For each of the 7 SV-Box forms (schemas from WP-168), write 3 synthetic personas with their confirmed facts and the gold value per applicant-owned field (exact and normalized form). Doctor, hospital and office fields stay empty in the gold set; IBAN only where the persona states it.

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

- [ ] AC1: 21 gold fillings (7 forms × 3 personas), every applicant field covered.
- [ ] AC2: The loader test validates each filling against the WP-168 form schema.
- [ ] AC3: Non-applicant fields are empty in every gold filling.

## Suggested commits

- `test(evals): add e7 form prefill gold set`
