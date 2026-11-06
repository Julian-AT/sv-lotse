# E11 slot extraction gold sets: set definition

## Goal

Write 300 utterances with gold slot values (PRD §14 E11): colloquial German and Austrian phrasing, simple language, English and a few other languages, covering the slot types the processes use (insurance status, carrier, federal state, age band, care need, hospital discharge date, relation of helper, income band, child birth date). Each item: utterance, expected slots with values and the source of the slot definition. Coordinate slot names with the knowledge process schema; where a process does not exist yet, use descriptive names and document them in the set README.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary.
- Built on `packages/knowledge` (schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation
  sets, the `packages/evals` harness.

## Data rules

- Use the case and suite schemas of the evals harness (`packages/evals/src/schema/**`); a loader
  test under `test/sets/e11/` validates every item of the set and its size, so the set is proven
  well-formed.
- Gold items reference their source passage (URL or SV-Box path plus quote or position); the leakage
  check (`packages/evals/src/checks/leakage.ts`) must pass against the catalog records that exist.
- Medical boundary (PRD §4): expected answers never contain a diagnosis, an interpretation of findings,
  a risk statement or medication advice.
- Synthetic personas and texts stay inside `packages/evals` and are labelled synthetic.

## Acceptance criteria

- AC1: 300 utterances, at least 60 non-German or simple-language.
- AC2: The loader test validates every item.
- AC3: No item contains medical advice.
