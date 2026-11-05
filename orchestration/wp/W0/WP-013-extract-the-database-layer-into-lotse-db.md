---
id: WP-013
title: Extract the database layer into @lotse/db
wave: W0
lane: db
risk: high
codex_effort: xhigh
depends_on: [WP-101]
fr: [NFR-13, NFR-15]
owns:
  - packages/db/**
  - packages/brain/src/db/**
  - packages/brain/src/storage/**
  - packages/brain/test/db/**
  - packages/brain/drizzle/**
  - packages/brain/drizzle.config.ts
  - docs/adr/0013-db-package.md
may_touch:
  - packages/brain/package.json
  - bun.lock
  - turbo.json
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/db typecheck
  - bun run --filter @lotse/db test
  - bun run --filter @lotse/db test:integration
  - bun run --filter @lotse/brain typecheck
pr_title: "refactor(db): move schema, migrations and storage into @lotse/db"
---

# WP-013: Extract the database layer into @lotse/db

## Goal and deliverables

`@lotse/knowledge` writes catalog rows and knowledge chunks through `@lotse/brain/db`, and the W1
brain must import the knowledge schemas (PRD §8 process engine). That is a package cycle, which the
Turborepo task graph rejects. Move the database layer into a new leaf package `@lotse/db` that both
depend on.

Deliverables:
1. `packages/db` (`@lotse/db`, TypeScript source exports like the other packages) containing what is
   now `packages/brain/src/db/**` (schema, client, approvals, migrations, migrate script, environment),
   `packages/brain/src/storage/**` (S3), `packages/brain/drizzle/**` and `drizzle.config.ts`, and the DB tests from
   `packages/brain/test/db/**`. Subpath exports: `.` (client), `./schema`, `./approvals`, `./migrations`,
   `./storage/s3`. Scripts: `typecheck`, `test` (no services), `test:db` and `test:integration`
   (services), `db:generate`, `db:migrate`. `package.json`, `README.md`, `AGENTS.md` (move the DB
   invariants from the brain's AGENTS.md).
2. Compatibility so in-flight WPs keep working: the brain keeps its subpath exports
   `./db`, `./db/schema`, `./db/approvals`, `./db/migrations`, `./storage/s3` as one-line re-export
   files of `@lotse/db`, and its `db:migrate`, `test:db`, `test:integration` scripts delegate to
   `@lotse/db`. Mark them deprecated in the brain AGENTS.md; WP-014 removes them.
3. Migrations stay byte-identical (moved, not regenerated); `db:migrate` against an existing
   database is a no-op.
4. ADR 0013: why the package exists and the dependency rule (db is a leaf; knowledge and brain depend
   on it; brain may depend on knowledge; knowledge never depends on brain).

## Context

- PRD sections for the requirement IDs above (§8 agent design and tools, §10 data, §14 evaluation,
  §4 boundaries); `AGENTS.md` at the root and in the packages you touch.

## Acceptance criteria

Each criterion is proven by a named test or gate against real services.

- [ ] AC1: All 42 database tests pass from `@lotse/db` against real Postgres and MinIO.
- [ ] AC2: `bun run --filter @lotse/brain db:migrate` still works and is a no-op on a migrated database.
- [ ] AC3: Every existing import of `@lotse/brain/db*` still typechecks (knowledge, web).
- [ ] AC4: `turbo run typecheck` has no cycle.

## Suggested commits

- `refactor(db): move schema, migrations and storage into @lotse/db`
