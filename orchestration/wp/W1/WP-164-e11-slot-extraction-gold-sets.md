---
id: WP-164
title: E11 slot extraction gold sets
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111]
fr: [E11]
owns:
  - packages/evals/sets/e11/**
  - packages/evals/test/sets/e11/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e11
pr_title: "test(evals): add e11 slot extraction gold sets"
---

# WP-164: E11 slot extraction gold sets

## Goal

Write 300 utterances with gold slot values (PRD §14 E11): colloquial German and Austrian phrasing, simple language, English and a few other languages, covering the slot types the processes use (insurance status, carrier, federal state, age band, care need, hospital discharge date, relation of helper, income band, child birth date). Each item: utterance, expected slots with values and the source of the slot definition. Coordinate slot names with the WP-101 process schema; where a process does not exist yet, use descriptive names and document them in the set README.

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

- [ ] AC1: 300 utterances, at least 60 non-German or simple-language.
- [ ] AC2: The loader test validates every item.
- [ ] AC3: No item contains medical advice.

## Suggested commits

- `test(evals): add e11 slot extraction gold sets`
