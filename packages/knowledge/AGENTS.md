# @lotse/knowledge

## Scope

The knowledge package owns ingestion and extraction plus source registries, catalog and process YAML, form schemas, offices, allowlists, guard patterns and embeddings. Domain records remain data instead of identifiers embedded in application logic.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/knowledge typecheck` — check source and test types.
- `bun run --filter @lotse/knowledge test` — run Vitest under Node.js.
- `bun run --filter @lotse/knowledge test:db` — real Postgres catalog synchronization tests;
  requires migrated tables from `bun run --filter @lotse/brain db:migrate`.
- `bun run --filter @lotse/knowledge catalog:load` — validate and synchronize the complete catalog;
  optionally pass a package root. This prunes absent catalog rows in the configured database.
- `bun run --filter @lotse/knowledge e2:scan` — validate data and scan production code;
  optionally pass a repository root.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation or live-service
script exists. Unit tests exclude `*.db.test.ts`; the database suite uses real Postgres in an isolated
schema cloned from the migrated public tables, with no product test doubles. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- Nothing without a source quote and `as_of`.
- YAML validated by strict Zod schemas; one record per YAML/JSON file, ids unique per kind.
- All record links resolve before loading. Records stay JSON-compatible; `Knowledge.resolve` accesses
  frozen targets without introducing cyclic objects. Process evaluation belongs to the brain engine.
- Data roots: `catalog`, `processes`, `offices`, `facilities`, `forms`; optional root registries are
  `allowlist.yaml` and `sources.yaml`. The package root must exist; missing data directories are allowed before fan-out. Symlinks are not.
- The dependency direction is knowledge → `@lotse/brain/db` or `@lotse/brain/db/schema` only.
  Brain never imports knowledge; it reads catalog records from Postgres. Do not import other brain
  subpaths, including from tests.
- Catalog database writes are one transaction with idempotent upserts and pruning by `key`.
  Form schemas identify existing acquired template versions with `template_id` (UUID); never invent
  PDF assets or prune form templates/instances.
- E2 collects all record ids, form `template_id` UUIDs and `life_situations`; literals and identifiers
  in brain/client sources must not embed them. TypeScript's JavaScript compiler API parses TS/JS/JSX;
  Swift has a separate lexer. The `typescript-compiler` alias uses the stable 6.x API because the
  repository's native 7.x compiler has no stable in-process parser. The typecheck command explicitly
  uses the root compiler to avoid the alias's local `tsc` binary.
  JSX attribute/text references are decoded before matching. Template UUIDs match without regard
  to case; other catalog ids retain case-sensitive matching.
- Stub references are checked repository-wide in source and build configuration, including generated
  sources and test files. Exceptions are exact paths in `src/e2/config.ts`: the scanner vocabulary
  and its regression fixtures. No production stub implementation is exempt. Build/dependency trees
  and original challenge input data are outside this source scan.
  Candidates come from Git: tracked files plus untracked files not ignored by Git. All E2 source
  checks use that candidate set. Private `.env*` paths are excluded before opening files; only
  `.env.example` is scanned. Dockerfile variants are included regardless of their suffix.
- Every online benefit appointment channel must match an origin in `allowlist.yaml` before knowledge
  is returned. Without online channels, the allowlist remains optional. Template updates compare
  `template_id` using Postgres UUID equality, including uppercase UUID spellings.
- Allowlist and guard patterns reviewed by a second person.
- Read original challenge files through `SVBOX_DIR`; never modify `data/svbox/`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep E2, schema validation and applicable retrieval and guard suites green as datasets and loaders land. Schema/loader/scan tests run without services; `test:db` requires real migrated Postgres.

## Forbidden paths

- Everything outside `packages/knowledge/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
