---
id: WP-004
title: Database schema, migrations and local services
wave: W0
lane: db
risk: high
depends_on: [WP-001]
fr: [FR-P1, FR-P5, FR-A2, FR-K1, FR-C10, FR-D5, FR-D10, FR-D11, NFR-4, NFR-5, NFR-15]
owns:
  - docker-compose.yml
  - packages/brain/src/db/**
  - packages/brain/src/storage/**
  - packages/brain/drizzle/**
  - packages/brain/drizzle.config.ts
  - packages/brain/test/db/**
  - docs/adr/0004-data-model-and-storage.md
may_touch:
  - packages/brain/package.json
  - packages/brain/vitest.config.ts
  - .env.example
allow_deps: none (baseline from WP-001); raise a contract change request if one is missing
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test:db
pr_title: "feat(db): add data model, migrations and local postgres and minio"
---

# WP-004: Database schema, migrations and local services

## Goal

The single store of PRD §11 exists, with these parts:

- a Drizzle schema for every entity in PRD §10 "Data model", with committed SQL migrations;
- a migration runner;
- database and S3 clients;
- a Docker Compose setup with Postgres (pgvector) and MinIO.

Tests prove the schema against a real Postgres.

## Context

- PRD §10 "Data model" (entity table), §11 "Storage", §13 "Approval records", NFR-4 (durability), NFR-15
  (portability: plain Postgres, no provider-specific extensions, S3-compatible storage).
- AI SDK UI messages are stored as JSON per message (`message` entity).
- `kb_chunk` needs pgvector (HNSW) and a `german` full-text index. Austrian synonyms (Spital and
  Krankenhaus, and so on) are expanded at query time in the retrieval code, not as Postgres dictionary
  files, so managed Postgres works too. Record this in the ADR.
- The pipeline creates one database per work package from the compose `db` service. Keep the
  superuser `lotse` and the default database `lotse`.

## Deliverables

1. **`docker-compose.yml`.**
   - `db`: `pgvector/pgvector:pg17`, user, password and database `lotse`, port 5432, named volume,
     `pg_isready` healthcheck.
   - `minio`: ports 9000 and 9001, healthcheck.
   - `minio-init`: one-shot, creates bucket `lotse`, `depends_on` minio healthy.

   `docker compose up -d --wait` must succeed.
2. **Drizzle schema.** In `packages/brain/src/db/schema/`, one file per aggregate:
   - users and subjects: `user` (kind `anonymous`), `session`, `subject`, `case_actor`, `profile`;
   - cases: `case`, `case_step`, `approval`, `message`, `turn`;
   - context: `fact`, `document`;
   - catalog: `benefit`, `office`, `facility`, `process` (typed key columns plus a JSONB record);
   - forms: `form_template` (registry: source, hash, version date, format, status `auto` or `verified`,
     schema JSONB, storage key) and `form_instance` (per-field value, provenance, state `draft` or
     `confirmed`, approval id);
   - knowledge: `kb_chunk`, `source`;
   - work and audit: `reminder`, `job`, `helper_session`, `audit_event`.

   Rules:
   - UUID primary keys; `timestamptz`; text enums with check constraints or pg enums;
   - foreign keys with deliberate `on delete` rules: deleting a subject deletes its facts, documents
     and derived facts (FR-P5).
3. **Constraints and indexes.**
   - `approval`: unique `approval_id`, `consumed_at`, `hmac`, `input_hash`, `session_id`, `actor_id`;
     at most one consumption, enforced by a conditional update.
   - `message`: unique (`case_id`, `position`).
   - `fact`: index (`subject_id`, `type`).
   - `kb_chunk`: `embedding vector(1536)` with an HNSW index (`vector_cosine_ops`) and a generated
     `tsv` column `to_tsvector('german', text)` with GIN. The embedding dimension is a documented
     decision in the ADR; changing it later is a migration plus re-embedding.
   - `audit_event`: append-only; a trigger rejects UPDATE and DELETE.
4. **Migrations.**
   - `db:generate` (drizzle-kit) writes SQL to `packages/brain/drizzle/`;
   - a custom first migration enables `vector` and `pgcrypto`;
   - `db:migrate` runs the drizzle-orm migrator from TypeScript, used by tests and at container start.
5. **Clients.**
   - `src/db/client.ts`: postgres.js pool; `DATABASE_URL` and pool size validated with Zod. The
     deployed database is Neon: honour `sslmode=require` in the URL and do not depend on anything
     Neon lacks (custom dictionaries, superuser-only settings).
   - `src/storage/s3.ts`: S3 client configured from the `S3_*` variables (path-style for MinIO);
     put, get, delete and head-bucket helpers, with the optional `S3_PREFIX` (default empty) applied
     to every key. The deployed store is Cloudflare R2 (`S3_REGION=auto`, endpoint
     `https://<account>.r2.cloudflarestorage.com`): use only operations R2 supports.
   - Keep `.env.example` minimal: add a variable only if nothing works without it; everything else
     gets a Zod default.
6. **Tests** (`test:db`, Vitest, against the compose Postgres and MinIO, no doubles):
   - migrations apply to an empty database;
   - every table and the listed indexes exist (catalog query);
   - an insert and select round trip for every entity;
   - `audit_event` UPDATE and DELETE fail;
   - an approval can be consumed once, and a second consume affects 0 rows;
   - German full-text search matches "Rezeptgebühren" against a chunk containing "Rezeptgebühr";
   - deleting a subject cascades to its facts and documents;
   - an S3 put, get and delete round trip under the prefix.
7. **ADR.** `docs/adr/0004-data-model-and-storage.md`: ids, enums, embedding dimension, synonym
   strategy, deletion semantics, migration workflow, and how per-work-package databases work in
   development.

## Acceptance criteria

- [ ] AC1: `docker compose up -d --wait` brings up `db` and `minio`, and `minio-init` creates the bucket.
- [ ] AC2: Every entity of PRD §10 exists with the listed key fields (test enumerates them).
- [ ] AC3: All `test:db` cases above pass against the real services.
- [ ] AC4: No provider-specific extension other than `vector` and `pgcrypto` (NFR-15).

## Notes for the implementer

- Docker may not be reachable inside your sandbox. Write the tests and list the Docker gates under
  `not_run`; the orchestrator runs them.
- There is no login: `user` and `session` support anonymous sessions only (PRD §11). Do not add
  credential tables.

## Suggested commits

- `build(infra): add docker compose with postgres pgvector and minio`
- `feat(db): add schema for cases, context, catalog, knowledge and audit`
- `feat(db): add migrations and migration runner`
- `feat(db): add postgres and s3 clients`
- `test(db): prove schema, constraints and storage against real services`
- `docs(adr): record data model and storage decisions`
