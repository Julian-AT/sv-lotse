# @lotse/evals

## Scope

The evals package owns evaluation suites E1–E13, personas, rubrics, red-team and gold sets, the evaluation runner and dashboard exports. Synthetic evaluation generators belong here.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/evals typecheck` — check source and test types.
- `bun run --filter @lotse/evals test` — offline unit tests under Vitest/Node.js.
- `RUN_LIVE=1 bun run --filter @lotse/evals test:live` — real OpenAI judge/persona tests.
- `bun run --filter @lotse/evals eval run --suite E1 --out /tmp/evals/summary.json` — arithmetic harness demonstration, not the product E1 gate.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build or generation step: the package exports TypeScript source. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node. The live launcher
loads root `.env.local` without overwriting exported values; without `RUN_LIVE=1` it makes no calls.

## Invariants

- Gold data references its source passage. Run `assertNoLeakage` against catalog records before
  evaluating a gold set; source quotes are provenance, not question/slot text.
- Rubrics use the JSON-compatible subset of YAML 1.2 with explicit versions and complete score
  anchors. Version prompt changes and recalibrate changed judges (PRD §14). Package Biome config
  preserves these JSON-compatible files: YAML formatting adds trailing commas incompatible with
  `JSON.parse`. Rubric schema tests validate both files; TypeScript lint/format stay enabled.
- Execute adapters propagate abort signals and throw `TransportError` only for transient transport
  failures. Keep SDK retries disabled; the runner owns retries and per-case deadlines.
- `passRate` is reserved; missing metric coverage and undersized sets must never pass a gate.
- A registered suite may define synchronous `reduce(results)` to replace mean aggregation. It
  receives all completed selected cases in selection order, including errors and timeouts, and
  returns finite nullable metrics without `passRate`. Return every suite metric: omitted metrics
  or metrics missing from a selected case become `null`. The runner still owns `passRate`, error
  rejection and minimum-set verdicts.
- Results contain synthetic data only, safe error categories, model/rubric/prompt versions and git SHA.
  Never attach raw provider errors or response bodies to exported errors.
- Synthetic generators stay inside this package.
- Test doubles stay in test files; acceptance tests use the real dependency named by their brief.
- E12 PDF text validation uses the declared `pdfjs-dist` legacy Node build, never
  system executables. `test/sets/e12/loader.test.ts` defines the visual-row text
  serialization used by gold quotes and page-local UTF-16 offsets; keep its
  convention documented in `sets/e12/README.md`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep runner, statistics, leakage, rubric and persona unit tests green. Live tests prove judge ranking
and a German persona conversation against OpenAI. The arithmetic demonstration reserves E1 only in
the standalone demonstration registry. E13 is available in `src/e13/index.ts`: use `registerE13`
with a WP-111 `Registry`, source-backed fixtures and an abort-aware detection adapter. It has no
brain dependency and does not modify the demonstration CLI's default registry.

E13 uses one-to-one maximum matching at IoU >= 0.5. Full recall/precision additionally require a
normalized label match and exact owner match. Box-only recall/precision, label match and owner
match are separate diagnostics. Both 90% recall and 95% precision are informational targets;
the suite reducer sums matched, detected and gold field counts across selected forms before
calculating recall, precision and target attainment. Diagnostic ratios also use summed counts;
`passRate` still describes per-form outcomes. The minimum set size stays 20. Three flattened SV-Box
fixtures run in the brain detection tests and must report `insufficient_data` rather than claiming
the full gold-set gate.

## Forbidden paths

- Everything outside `packages/evals/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
