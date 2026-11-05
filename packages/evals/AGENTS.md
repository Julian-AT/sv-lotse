# @lotse/evals

## Scope

The evals package owns evaluation suites E1–E13, personas, rubrics, red-team and gold sets, the evaluation runner and dashboard exports. Synthetic evaluation generators belong here.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/evals typecheck` — check source and test types.
- `bun run --filter @lotse/evals test` — run Vitest under Node.js.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation, integration or live-test
script exists yet; add and document one only when its implementation lands. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- Gold data references its source passage.
- Synthetic generators stay inside this package.
- Test doubles stay in test files; acceptance tests use the real dependency named by their brief.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep the runner's tests and applicable E1–E13 suites green as they are introduced. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/evals/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
