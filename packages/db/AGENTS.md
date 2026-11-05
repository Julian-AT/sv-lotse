# @lotse/db

## Scope

The shared persistence package owns the Postgres schema, client, approval consumption primitive,
migrations and S3-compatible object storage. It exports TypeScript source without a build step.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/db typecheck` — check source and test types.
- `bun run --filter @lotse/db test` — run Vitest under Node.js without services.
- `bun run --filter @lotse/db test:db` — run all database tests against real Postgres and MinIO.
- `bun run --filter @lotse/db test:integration` — run `test:db` for the CI integration job.
- `bun run --filter @lotse/db db:generate` — generate SQL and snapshots from the Drizzle schema.
- `bun run --filter @lotse/db db:migrate` — apply committed migrations to `DATABASE_URL`.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

Run TypeScript tooling scripts with `bun <file>.ts` and use only Node APIs so they also run under
Node. Start local dependencies with `docker compose up -d --wait`. The migration CLI and database
tests load the root `.env.local` without overwriting supplied environment variables. Database tests
create and drop a unique temporary database using the configured connection; the local `lotse` role
needs `CREATEDB`. Storage tests use a unique object prefix and delete their objects. `test:db` and
`test:integration` require the real services; neither skips service tests when dependencies are
unavailable. `test` excludes `test/**/*.db.test.ts` and runs without these services.

## Invariants

- This is a leaf workspace package: no imports from other `@lotse/*` packages or `apps/*`.
  Knowledge and brain depend on db; brain may depend on knowledge; knowledge never depends on brain.
  WP-013 temporarily preserves the old brain subpaths for consumers migrating in WP-014.
- ESM only, with strict TypeScript. Keep external dependencies at the repository baseline.
- No benefit, scenario, form or office id in code.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.
- Persistence entrypoints are `src/db/client.ts`, `src/db/schema/index.ts`,
  `src/db/migrations.ts`, `src/db/approvals.ts` and `src/storage/s3.ts`. Client factories validate
  environment variables at creation and expose explicit cleanup; reuse one pool per process.
- Run migrations once as a deployment/container-start step before serving requests. Do not run
  concurrent migration runners against one database. Never use `drizzle-kit push` for deployments.
- Generate schema migrations; author extension/trigger SQL only in `db:generate --custom --name=...`
  migration slots. Never edit existing committed migrations or generated snapshots.
- Keep `drizzle/**` in Turborepo's test inputs: the service-free migration test reads those files.
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
- The AI SDK dependency supplies the existing persisted `UIMessage` type only; no agent or model
  execution belongs in this package.

## Forbidden paths

- Everything outside `packages/db/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
