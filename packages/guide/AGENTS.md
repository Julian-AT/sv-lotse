# @lotse/guide

## Scope

The guide package owns the page runtime for snapshots, pointing, highlighting and fill previews. It applies deny-list data while operating inside guided pages.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/guide typecheck` — check source and test types.
- `bun run --filter @lotse/guide test` — run Vitest under Node.js.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation, integration or live-test
script exists yet; add and document one only when its implementation lands. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- Deny list is data, not code.
- No network calls.
- Shadow DOM only.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep E8 and deny-list fixtures green when the guide runtime is introduced. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/guide/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
