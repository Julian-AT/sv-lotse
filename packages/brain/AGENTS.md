# @lotse/brain

## Scope

The TypeScript brain owns agent orchestration, tools, the process engine, context assembly, guards, model routing and persistence. It is hosted by the web app and contains the product's business logic.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/brain typecheck` — check source and test types.
- `bun run --filter @lotse/brain test` — run Vitest under Node.js, excluding `test/**/*.db.test.ts`.
- `bun run --filter @lotse/brain test:db` — run persistence tests against real Postgres and MinIO.
- `bun run --filter @lotse/brain test:integration` — run `test:db` for the CI integration job.
- `bun run --filter @lotse/brain db:generate` — generate SQL and snapshots from the Drizzle schema.
- `bun run --filter @lotse/brain db:migrate` — apply committed migrations to `DATABASE_URL`.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. Run TypeScript tooling scripts with
`bun <file>.ts` and use only Node APIs so they also run under Node. Start local dependencies with
`docker compose up -d --wait`. The migration CLI and database tests load the root `.env.local` without
overwriting supplied environment variables. Database tests create and drop a unique temporary database
using the configured connection; the local `lotse` role needs `CREATEDB`. Storage tests use a unique
object prefix and delete their objects. `test:db` and `test:integration` require the real services;
neither skips service tests when dependencies are unavailable. `test` runs without these services.

## Invariants

- No benefit, scenario or office id in code.
- Every tool has Zod input and output.
- Approval record, HMAC and input hash checked before approval-gated tools.
- History loaded from Postgres, never trusted from the client.
- No import from `apps/*`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.
- Persistence entrypoints are `src/db/client.ts`, `src/db/schema/index.ts`,
  `src/db/migrations.ts`, `src/db/approvals.ts` and `src/storage/s3.ts`. Client factories validate
  environment variables at creation and expose explicit cleanup; reuse one pool per brain process.
- Run migrations once as a deployment/container-start step before serving requests. Do not run
  concurrent migration runners against one database. Never use `drizzle-kit push` for deployments.
- Generate schema migrations; author extension/trigger SQL only in `db:generate --custom --name=...`
  migration slots. Never edit existing committed migrations or generated snapshots.
- Facts reference exactly one source document, turn or fact. Their foreign keys cascade transitively.
  Subject deletion cascades through cases and context; object deletion is a storage-service concern.
- `consumeApproval` is an atomic persistence primitive, called only after cryptographic and actor
  authorization checks in the approval service. A zero-row result must reject execution.
- Form instance `fields` are a JSONB map of field ids to value, provenance, state and approval id.
  Validate writes and reads with `formFields`; confirmed fields require an approval id.
- Audit records contain only opaque identifiers and action names, never user content. They have no
  cascading foreign keys; the database rejects UPDATE, DELETE and TRUNCATE.
- Only `vector` and `pgcrypto` extensions are installed. Embeddings have 1536 dimensions; changing
  this requires a migration and re-embedding. Austrian synonyms expand at query time.

## Evaluation suites

Keep applicable E1–E13 suites green as brain features land; E2 enforces data-driven logic and E5 enforces the medical boundary. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/brain/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
