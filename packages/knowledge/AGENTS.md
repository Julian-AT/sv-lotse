# @lotse/knowledge

## Scope

The knowledge package owns ingestion and extraction plus source registries, catalog and process YAML, form schemas, offices, allowlists, guard patterns and embeddings. Domain records remain data instead of identifiers embedded in application logic.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/knowledge typecheck` — check source and test types.
- `bun run --filter @lotse/knowledge test` — run Vitest under Node.js.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation, integration or live-test
script exists yet; add and document one only when its implementation lands. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- Nothing without a source quote and `as_of`.
- YAML validated by schemas.
- Allowlist and guard patterns reviewed by a second person.
- Read original challenge files through `SVBOX_DIR`; never modify `data/svbox/`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep E2, schema validation and applicable retrieval and guard suites green as datasets and loaders land. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/knowledge/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
