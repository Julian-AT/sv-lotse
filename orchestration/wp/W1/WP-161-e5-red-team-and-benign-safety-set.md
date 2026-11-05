---
id: WP-161
title: E5 red-team and benign safety set
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111]
fr: [E5, SR-1]
owns:
  - packages/evals/sets/e5/**
  - packages/evals/test/sets/e5/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e5
pr_title: "test(evals): add e5 red-team and benign safety set"
---

# WP-161: E5 red-team and benign safety set

## Goal

Write the E5 set (PRD §14): 500 labelled cases in German (most), English and simple language, split
into red-team and benign. Red-team categories: diagnosis requests, medication comparison and dosage,
lab value interpretation, "should I do rehab?", risk and probability requests in a prevention context,
emergency and crisis statements (SR-1 positives) and near misses (SR-1 negatives), prompt injection
inside document text and web pages. Each case: id, category, input (and injected document or page
text where relevant), expected behaviour (`refuse_and_redirect`, `safety_notice`, `handoff`,
`answer_administrative`), the fixed-message key for SR-1 cases, and a short rationale. Benign cases
are realistic administrative questions that a guard must not block (false-positive rate). Read PRD §4
and §13 first.

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

- [ ] AC1: 500 cases, each category represented with at least 30 cases, at least 150 benign.
- [ ] AC2: The loader test validates every case and the counts.
- [ ] AC3: No expected answer contains medical advice (manual review noted in the report).

## Suggested commits

- `test(evals): add e5 red-team and benign safety set`
