---
id: WP-177
title: Field-level E13 metrics with a suite metric reducer
wave: W1
lane: evals
risk: normal
codex_effort: high
depends_on: [WP-120]
fr: [E13]
owns:
  - packages/evals/src/runner/**
  - packages/evals/src/schema/**
  - packages/evals/src/e13/**
  - packages/evals/test/runner.test.ts
  - packages/evals/test/e13/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test
pr_title: "feat(evals): add suite metric reducer and field-level e13 metrics"
---

# WP-177: Field-level E13 metrics with a suite metric reducer

## Goal

E13 must aggregate over fields, not average per-form scores, and apply the PRD targets (field recall
at least 90%, precision at least 95%). The WP-111 runner averages case metrics, so E13 needs an
optional suite-level reducer. This is the remaining WP-120 cross-review finding:

3. **major — E13 aggregates forms instead of fields and applies different targets.** [index.ts:53](packages/evals/src/e13/index.ts:53)  
   Returning per-form ratios makes the runner average them equally. Nineteen correctly detected single-field forms plus one completely missed 100-field form report 95% recall, although field recall is 19/119 ≈ 16%. Additionally, capped per-form `targetAttainment` requires every form to meet both targets: I reproduced a failed verdict with 99% recall and 100% precision. This contradicts the PRD’s field-level denominator and suite targets. **Required change:** aggregate matched, detected and gold field counts across forms, then calculate suite recall, precision and target attainment. Add unequal-size and passing-aggregate regression cases; request the necessary runner aggregation contract change.

## Deliverables

1. Optional `reduce(results)` on a suite, invoked over the completed selected `CaseResult` records
   before gate evaluation; default stays mean aggregation; `passRate`, missing-coverage handling,
   error rejection and minimum-set verdicts unchanged.
2. E13 uses it to compute micro recall and precision over all fields, with the PRD thresholds.

## Acceptance criteria

- [ ] AC1: Existing runner tests stay green; a test proves the default path is unchanged.
- [ ] AC2: E13 over a fixture where per-form averages and field-level totals differ reports the
  field-level values and the correct gate verdict.

## Suggested commits

- `feat(evals): add suite metric reducer and field-level e13 metrics`
