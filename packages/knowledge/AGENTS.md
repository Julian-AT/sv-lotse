# @lotse/knowledge

## Scope

The knowledge package owns ingestion and extraction plus source registries, catalog and process YAML, form schemas, offices, allowlists, guard patterns and embeddings. Domain records remain data instead of identifiers embedded in application logic.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/knowledge typecheck` — check source and test types.
- `bun run --filter @lotse/knowledge test` — run Vitest under Node.js.
- `bun run --filter @lotse/knowledge test:db` — real Postgres tests for catalog synchronization and
  ingestion transactions; requires migrated tables from `bun run --filter @lotse/brain db:migrate`.
- `RUN_LIVE=1 bun run --filter @lotse/knowledge test:live` — one official page, real OpenAI embeddings,
  German full-text and vector search against migrated real Postgres.
- `bun run --filter @lotse/knowledge catalog:load` — validate and synchronize the complete catalog;
  optionally pass a package root. This prunes absent catalog rows in the configured database.
- `bun run --filter @lotse/knowledge e2:scan` — validate data and scan production code;
  optionally pass a repository root.
- `bun run --filter @lotse/knowledge ingest --origin www.oegk.at --limit 1 --dry-run` — fetch,
  normalize and chunk without database writes or provider calls; omit `--dry-run` to index.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. Unit tests exclude `*.db.test.ts` and
`*.live.test.ts`; the database suites use real Postgres with no product test doubles. The ingestion
CLI runs under Node.js 22 with type stripping; CLI and integration-test entrypoints load root
`.env.local` without overriding existing environment variables, and other modules never load
environment files on import. Run TypeScript tooling scripts with `bun <file>.ts` and use only Node
APIs so they also run under Node.

- `bun run --filter @lotse/knowledge test:db` — run SozDok integration tests against real Postgres after brain migrations.
- `bun run --filter @lotse/knowledge sozdok:load [--on YYYY-MM-DD]` — load SozDok sources; see `src/loaders/sozdok/README.md`.
  There is no build step: the package exports TypeScript source. Unit/corpus tests exclude
  `*.db.test.ts`; `test:db` explicitly runs the database suite. No generation or live-test script exists.
  Run TypeScript tooling scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

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
- SozDok provision identity is `(law_abbr, gldart, gldnr)`; validity ends exclusively at the next version.
- SozDok sources use stable IDs because `source.url` has no uniqueness constraint. Never write
  `kb_chunk` without a supplied, validated embedding; source-only reloads invalidate changed chunks.
- SozDok loads hold one namespaced transaction lock and reconcile incoming and persisted provision
  history atomically. Partial directories must preserve known validity bounds and invalidate chunks
  when their text, validity, citation or chunk metadata changes.
- SozDok table rows stay together only when they fit the chunk budget; inner absatz remain splittable.
- SozDok database fixtures use unique test-only document IDs; cleanup must never delete corpus IDs.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.
- Ingestion schemas live in `src/ingest/` pending WP-101 consolidation; `./ingest` exports the pipeline.
- Ingestion seeds live in `ingest-sources.yaml`; `sources.yaml` is reserved for the shared
  provenance registry. Ingestion uses the shared `AllowlistSchema` shape (`origins`, `sources`,
  `as_of`, `verified_at`) and additionally rejects duplicate origins. The Pensionsversicherung
  origin is `https://www.pv.at`.
- Only exact allowlisted origins may be fetched, including robots and redirect destinations.
  Missing robots (404/410) permits crawling; denied/unavailable robots fails closed. Per-origin
  requests are serial, with a one-second minimum delay or a longer published crawl delay.
- PDFs yield `not_supported` / `pdf_text_extraction_unavailable`: the baseline has no text-layer
  extractor. They are never sent to the normalizer, embedding provider or indexer.
- Indexing serializes cooperating writers with a transaction advisory lock by source URL. Do not
  bypass it: the frozen database schema has no URL uniqueness constraint. Source replacement and
  chunk replacement share one transaction. A global embedding advisory lock precedes the URL lock;
  model changes atomically re-embed all incompatible stored chunks, including legacy records.
  Source and chunk `metadata.embedding` record `{ model, dimensions }`. Only unchanged hashes with
  matching identities perform no writes or embedding calls; mismatches disable HTTP validators.
  Retrieval must filter by the query embedder's identity to handle older query processes safely.
- Normalize ARIA headings before chunking and expand table row/column spans into their correct grid
  positions. Preserve informational form descendants and keep normalized table captions with their
  indivisible tables. Only document-head validity metadata and page-preamble labels (including
  neutral layout wrappers) set global dates. Heading and semantic section scopes carry their own
  dates to indexed chunks, inherit and may narrow parent intervals, and never expire siblings.
  Section scopes are part of the content hash, including when plain Markdown is unchanged.
- Raw HTML and HTTP validators live in source metadata; German `tsv` is generated by Postgres.
  Austrian synonyms are expanded at query time, never via custom Postgres dictionaries.
- Immutable downloaded HTML fixtures use `.html.txt` to keep source-site markup out of code linting.
  Preserve markup, redact provider keys, verification tokens, session IDs and tracking IDs with
  `REDACTED`, and record origin/retrieval date and redactions in the fixture README. Check saved
  fixtures with `gitleaks dir --redact packages/knowledge` before adding them.

## Evaluation suites

Keep E2, schema validation and applicable retrieval and guard suites green as datasets and loaders land. Schema/loader/scan tests run without services; `test:db` requires real migrated Postgres.

## Forbidden paths

- Everything outside `packages/knowledge/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
