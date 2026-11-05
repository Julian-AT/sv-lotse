# @lotse/ui

## Scope

The UI package owns shared React components for the web workspace. Components provide accessible presentation and interaction while the brain owns business logic and the workspace owns the conversation client.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/ui typecheck` — check source and test types.
- `bun run --filter @lotse/ui test` — run Vitest under Node.js.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation, integration or live-test
script exists yet; add and document one only when its implementation lands. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- WCAG 2.2 AA checks in component tests.
- 44-point targets.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep accessibility and keyboard component tests green as components are introduced. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/ui/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
