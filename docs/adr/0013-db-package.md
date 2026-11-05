# ADR 0013: Shared database leaf package

- Status: accepted; updates persistence ownership in ADR 0004
- Date: 2026-11-05
- Requirements: NFR-13, NFR-15; PRD §8, §10, §14

## Context

Knowledge loaders write catalog rows and knowledge chunks through `@lotse/brain/db`. The brain's
process engine needs knowledge schemas (PRD §8). If knowledge continues to depend on brain when
brain imports knowledge, the workspace dependency graph contains a cycle that Turborepo rejects.
Persistence is shared infrastructure and does not need either package's business logic.

## Decision

Move the Postgres schema, client, environment loader, approval consumption primitive, migration
runner, Drizzle configuration, committed migrations and S3 transport into `@lotse/db`. Move their
tests with them. Like the other workspace packages, db exports TypeScript source without a build
step. Its public entrypoints are `.`, `./schema`, `./approvals`, `./migrations` and `./storage/s3`.

The dependency rule is:

- Db is a leaf: it never depends on brain, knowledge, protocol or any app/workspace package.
- Knowledge and brain depend on db for shared persistence.
- Brain may depend on knowledge for its schemas and data-loading interfaces.
- Knowledge never depends on brain.

Db retains the baseline external dependencies. The AI SDK import is type-only and preserves the
existing persisted `UIMessage` contract; no agent runtime or provider calls move into db.
Schema constraints, approval semantics, audit immutability and the portable Postgres/S3 interfaces
from ADR 0004 remain unchanged. This extraction introduces no database schema changes.

## Compatibility and rollout

This change keeps the brain exports `./db`, `./db/schema`, `./db/approvals`, `./db/migrations` and
`./storage/s3` as one-line re-exports of db. Brain's `db:migrate`, `db:generate`, `test:db` and
`test:integration` scripts delegate to db, retaining their working directory and argument handling.
The existing knowledge dependency on brain temporarily remains through these compatibility exports.
A later migration moves consumers to db and removes these deprecated entrypoints and delegates before brain
adds a dependency on knowledge. Adding that edge earlier would still create a cycle.

All committed migration SQL, snapshots and the journal move byte-for-byte, without generation.
The migration runner retains its module-relative path to the moved `drizzle/` directory, and the
environment loader retains its relative path to the repository `.env.local`. Existing migration
hashes and timestamps therefore identify the same migrations; rerunning the brain delegate on a
migrated database adds no migration rows and reapplies no schema DDL.

## Consequences and verification

Both packages can share persistence without coupling knowledge ingestion to the agent runtime.
Migration generation and execution now belong to db, as do the persistence invariants in its
README. Business logic and approval authorization stay with brain.

`test` excludes service tests. `test:db` and `test:integration` execute the complete existing
42-test database suite against real Postgres and MinIO. The service-free migration test reads the
committed migration artifacts, so Turborepo's `test` inputs include `drizzle/**` to invalidate cached
results when those files change. Explicit inputs replace the default file set
([Turborepo configuration](https://turborepo.dev/docs/reference/configuration#inputs)).
Verify the compatibility migration command against an already migrated database and compare
migration history before and after extraction.
Typecheck existing knowledge consumers through the brain exports and run the full Turborepo
typecheck graph to verify compatibility and the absence of a cycle.
