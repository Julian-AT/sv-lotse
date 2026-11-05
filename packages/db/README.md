# @lotse/db

Shared Postgres persistence and S3-compatible object storage for SV KI-Lotse. This leaf workspace
package exports TypeScript source and depends on no other workspace package. Brain and knowledge
share its schema and clients; it contains no agent orchestration or catalog loading logic.

| Import                 | Purpose                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| `@lotse/db`            | `createDatabase`, `databaseEnvironment`, `Database`, `DatabaseClient` |
| `@lotse/db/schema`     | Drizzle tables, enums and form-field validation                       |
| `@lotse/db/approvals`  | Atomic `consumeApproval` persistence primitive                        |
| `@lotse/db/migrations` | `migrateDatabase` and the module-relative migration directory         |
| `@lotse/db/storage/s3` | `createObjectStorage` and `storageEnvironment`                        |

Factories validate environment variables with Zod. Reuse a database pool per process and call
`close()` on both clients at shutdown. Imports do not read configuration or open connections.
Approval authorization and cryptographic verification remain the caller's responsibility.

Run these commands from the repository root:

```sh
docker compose up -d --wait
bun run --filter @lotse/db db:migrate
bun run --filter @lotse/db typecheck
bun run --filter @lotse/db test
bun run --filter @lotse/db test:integration
```

`test` runs without services. `test:db` and `test:integration` run the complete database suite against
real Postgres and MinIO. They create a unique temporary database (the connection role needs
`CREATEDB`) and use a unique S3 object prefix, then clean up both. Missing services fail the suite.

The migration CLI and service tests load the root `.env.local`, preserving environment variables
provided by the caller. Database configuration uses `DATABASE_URL` and optional
`DATABASE_POOL_SIZE`. Object storage uses `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY`, with optional `S3_REGION`, `S3_FORCE_PATH_STYLE` and `S3_PREFIX`.
See the repository `.env.example` for local development configuration.

Apply migrations once before serving requests, with one runner per database. The committed SQL,
journal and snapshots moved unchanged from brain; migrated databases require no data migration.
For future schema changes, run `bun run --filter @lotse/db db:generate` and commit all generated
artifacts together. Never edit existing migrations or use `drizzle-kit push` in deployments.

The old `@lotse/brain/db*` and `@lotse/brain/storage/s3` exports and brain database scripts remain
deprecated compatibility delegates until WP-014. New consumers use `@lotse/db` directly. The
dependency rule and transition are recorded in [ADR 0013](../../docs/adr/0013-db-package.md).
