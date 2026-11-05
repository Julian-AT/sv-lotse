---
id: WP-111
title: Evaluation harness with runner, Wilson intervals, judge and persona simulator
wave: W1
lane: evals
risk: normal
codex_effort: high
depends_on: [WP-001]
fr: [NFR-13, E1, E3, E4, E5, E6, E10]
owns:
  - packages/evals/**
may_touch:
  - bun.lock
allow_deps: "`@ai-sdk/openai` (same version as the brain); `@lotse/protocol` as `workspace:*`"
live_services: [openai]
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test
  - RUN_LIVE=1 bun run --filter @lotse/evals test:live
pr_title: "feat(evals): add evaluation runner with intervals, judge and persona simulator"
---

# WP-111: Evaluation harness with runner, Wilson intervals, judge and persona simulator

## Goal

`packages/evals` gets the machinery every evaluation suite (E1 to E13) runs on: a suite registry, a
deterministic runner with tagged CI subsets, statistics with Wilson intervals, an LLM judge scored on
versioned rubrics, a simulated user persona for multi-turn scenario runs, and a JSON result format
for the dashboard. Later WPs only add suites and data sets.

## Context

- PRD §14 in full: suites table, gates (blocking or informational), scenario rubric, judge
  calibration (Cohen's kappa ≥ 0.8 on a human-labelled subset), test data and leakage rule, CI
  (fast subsets per PR, all suites nightly, E10 weekly).
- PRD §17 `packages/evals` invariants: gold data references its source passage; synthetic
  generators stay inside this package. No test doubles outside `packages/evals` and test dirs.
- The brain and its model router do not exist yet (WP-006). The harness talks to the system under
  test through an interface, and to the judge model through the AI SDK with `@ai-sdk/openai`.

## Scope

In scope: runner, registry, case and result schemas, statistics, judge, persona simulator, subset
selection, result export, a CLI entry, and one self-contained demonstration suite that exercises
the harness end to end without the brain.

Out of scope: concrete product suites and gold sets (WP-161 to WP-165, WP-120 for E13), the
dashboard UI, wiring suites into CI workflows (a later CI WP).

## Deliverables

1. **Schemas** (`src/schema/**`, Zod): `Suite` (id `E1`…`E13`, name, gate `{ kind: blocking |
   informational, metric, threshold }`, minimum set size), `Case` (id, tags, input, expected,
   `source` reference required for gold items), `CaseResult`, `SuiteResult` (counts, metric values,
   Wilson 95% interval, gate verdict, model and judge versions, git sha, timestamps).
2. **Registry and runner** (`src/runner/**`): register suites; run with concurrency limit, per-case
   timeout, retries for transport errors only, deterministic ordering and seeded sampling.
   Subsets by tag (`pr`, `nightly`, `weekly`) and by `--sample n --seed s`.
3. **Statistics** (`src/stats/**`): Wilson score interval (any confidence), proportion and mean
   aggregation, Cohen's kappa for judge calibration, recall@k and nDCG@k for E3.
4. **Judge** (`src/judge/**`): rubric files (YAML, versioned, binary or three-point criteria with
   written anchors, schema-validated); `judge(run, rubric)` calls the model through AI SDK
   `generateObject`/structured output with a Zod schema per rubric; model from `EVAL_JUDGE_MODEL`
   (default documented); returns per-criterion scores with a short rationale; records judge model
   and rubric version in results.
5. **Persona simulator** (`src/persona/**`): a persona spec (language, age, carrier, region, goal,
   facts it knows, style such as colloquial or simple language) drives a simulated user over a
   `SystemUnderTest` interface `{ startCase(), sendTurn(text): Promise<{ text, events }> }` until
   goal reached, give-up or turn limit. Persona model from `EVAL_PERSONA_MODEL`. The interface lets
   WP-106 plug in the real brain later.
6. **Leakage check** (`src/checks/leakage.ts`): fails when a gold item quotes a given corpus
   (catalog records) verbatim above a length threshold.
7. **Export and CLI**: `bun src/cli.ts run --suite E3 --subset pr --out results/…json`; results as
   JSON per suite plus a summary; non-zero exit when a blocking gate fails.
8. **Demonstration suite**: a tiny arithmetic or string suite using the full path (registry, runner,
   stats, gate, export) without any model, used by unit tests.
9. **Scripts**: `test` (unit, no network), `test:live` (judge and persona against OpenAI, skipped
   unless `RUN_LIVE=1`), `eval` (CLI). Update `packages/evals/AGENTS.md` and `README.md`.

## Acceptance criteria

- [ ] AC1: Wilson interval matches reference values (e.g. 81/100 at 95% → 0.7222–0.8749 within
  1e-4), handles 0/n and n/n, and Cohen's kappa matches a textbook example.
- [ ] AC2: The runner is deterministic: same seed and subset select the same cases in the same
  order; a failing blocking gate makes the CLI exit non-zero; results validate against the schema.
- [ ] AC3: recall@10 and nDCG@10 match hand-computed values on a fixture ranking.
- [ ] AC4 (live): the judge scores two fixed transcripts against a sample rubric and returns
  schema-valid scores, with the clearly good transcript scoring higher on every criterion.
- [ ] AC5 (live): the persona simulator completes a short conversation against a trivial echo
  `SystemUnderTest` defined in the test, within the turn limit, in German.
- [ ] AC6: Leakage check flags a gold item that copies a 20-word catalog passage and passes a
  paraphrase with a source reference.

## Notes for the implementer

- Check the AI SDK 7 structured-output API (`generateObject` or `generateText` with `output`) in the
  current docs.
- Keep model names in environment variables with documented defaults; no provider key in code.
- Logs and results contain no personal data beyond synthetic personas.

## Suggested commits

- `feat(evals): add suite schemas, registry and deterministic runner`
- `feat(evals): add wilson intervals, kappa and ranking metrics`
- `feat(evals): add rubric judge and persona simulator`
- `test(evals): add live judge and persona tests`
