# ADR 0004: Data model and portable storage

- Status: accepted
- Date: 2026-11-05
- Requirements: PRD §10, §11, §13; FR-P1, FR-P5, FR-A2, NFR-4, NFR-5, NFR-15

## Context

Every client, helper view and background worker needs one durable store. The pilot uses Neon
Postgres and Cloudflare R2; development uses Postgres 17 with pgvector and MinIO. The same schema,
migrations and storage operations must work on both. There is no login in v1.

## Decisions

### Identifiers, enums and JSON

All 24 entities in the PRD data model have UUID primary keys generated with `gen_random_uuid()`.
Catalog entries additionally have unique text keys for repository records. The public approval id
is unique text, separate from the UUID row id, because it travels through the AI SDK protocol.
Dates representing instants use `timestamptz`; a form's published version date uses `date`.

Use Postgres enums for finite lifecycle states and preference choices. User kind supports only
`anonymous`; sessions distinguish web, Mac and helper clients. There are no credential tables.
Extensible domain types, catalog keys, carrier and region remain text, without coded domain ids.
Adding an enum value is a schema migration.

Each aggregate has a schema file. Typed key columns and foreign keys support lookup and ownership;
JSONB preserves catalog records and durable runtime state. Each message stores one AI SDK UI
message, with a unique `(case_id, position)` ordering. Turns persist message ids, capsule digest,
segments, tool calls, action results, model ids, timings and status. Jobs persist step state,
status and attempts. Future runtimes resume from these records rather than process memory.

Form templates store source, retrieval time, file hash, version date, format, page count, detection
status, schema and object key. Instances store a field-id map; each field has its value,
provenance, draft/confirmed state and nullable public approval id. The `formFields` Zod schema
validates that confirmed values have an approval id. The forms service must validate these JSON
boundaries and verify the referenced approval before confirming a group. Templates cannot be
deleted while an instance uses them.

### Approvals and audit

Approvals bind a case, tool call and tool name to the canonical input hash, actor and session,
decision, request/decision/consumption times and server HMAC. Checks enforce SHA-256 hex input hashes
and consistent decision/consumption timestamps. `consumeApproval` uses one conditional UPDATE
matching the approval id, actor, session, hash, HMAC, approved decision and `consumed_at IS NULL`.
Postgres rechecks the condition after a competing update; exactly one caller gets a row back.
A zero-row result rejects execution. Cryptographic verification, actor authorization and setting
the decision belong to the approval service; the persistence helper does not replace those checks.

Audit records are append-only: a trigger rejects UPDATE, DELETE and TRUNCATE. Actor, target and
approval identifiers are deliberately opaque references without foreign keys, so deleting user
context cannot mutate audit history through cascading deletes or SET NULL. Store action names and
identifiers only, never source text, form values or document content. Export can read audit records;
ordinary context deletion leaves this minimal event history intact. A future requirement to erase
audit records themselves needs an explicit privileged retention/purge policy compatible with the
append-only requirement; disabling the trigger in application code is not allowed.

### Deletion semantics

Deleting a user cascades to their sessions, profile, created subjects and case memberships.
Deleting a subject cascades to cases, documents, facts and form instances. Case deletion cascades
to steps, actors, approvals, messages, turns, instances, reminders, jobs and helper sessions.
Deleting a source document, turn or fact deletes its derived facts, including transitive derivations.
Each fact references exactly one of those sources, and cannot reference itself.
Catalog processes restrict deletion of referenced benefits; source deletion removes its KB chunks.

Object storage is outside Postgres transactions. The deletion service must durably enumerate or
queue document and generated-output keys before deleting their rows, then delete the objects with
retries. A database cascade alone does not erase stored objects. Document envelope encryption also
belongs to the document service; the S3 transport stores the bytes it receives.

### Knowledge indexes

Use `vector(1536)` with an HNSW cosine index (`vector_cosine_ops`). 1536 is the initial embedding
dimension and an explicit storage contract. A different model/dimension requires both a migration
and re-embedding all chunks before switching retrieval.

The stored generated `tsv` column uses `to_tsvector('german'::regconfig, text)` and a GIN index.
Austrian synonyms such as Spital/Krankenhaus are expanded at query time in retrieval code. No custom
dictionary files, server configuration or provider-specific extension is needed. Only `vector`
and `pgcrypto` are enabled; built-in `plpgsql` implements the audit trigger.

### Clients and configuration

`createDatabase` validates `DATABASE_URL` and an optional `DATABASE_POOL_SIZE` (default 10, 1–100),
then creates a reusable postgres.js pool and Drizzle client. It passes the URL through without
overriding TLS: Neon URLs with `sslmode=require` retain that setting. No superuser settings or
Neon-specific API are used. Each process closes its pool on shutdown.

`createObjectStorage` validates the endpoint, bucket and credentials from `S3_*`. Region defaults
to `auto`, path-style addressing to true and prefix to empty. An optional `S3_PREFIX` has boundary
slashes removed and is prepended with one separator to every object key; callers pass relative
keys. The helpers use only PutObject, GetObject, DeleteObject and HeadBucket, supported by MinIO
and R2. Optional checksum negotiation is restricted to required checksums for S3 compatibility.
R2 uses `S3_REGION=auto` and its account endpoint; no AWS-only ACL, KMS or bucket-management calls
are used. MinIO initialization is a separate local Compose concern.

### Migrations and development databases

Run `bun run --filter @lotse/brain db:generate` after changing schema source and commit its SQL,
snapshots and journal together. Never edit generated migrations or snapshots. Use
`db:generate --custom --name=...` for authored SQL unsupported by the schema generator.
The first custom migration enables extensions, the second is generated schema DDL, and the third
installs the append-only trigger. The TypeScript `db:migrate` entrypoint loads the repository's
`.env.local` without overwriting supplied variables and calls the Drizzle ORM migrator. Run it
once before a container starts serving requests, serialized by deployment orchestration. The same
exported runner is used in tests. It locates migrations relative to its module, independent of cwd.

Compose keeps the superuser and default database named `lotse` and persists both Postgres and
MinIO in named volumes. Published ports bind to loopback. MinIO uses
`bitnamilegacy/minio:2025.7.23-debian-12-r5`, and its initialization client uses
`bitnamilegacy/minio-client:2025.7.21-debian-12-r3`. These pinned images are pullable; the previously
selected Quay releases return HTTP 401, and the upstream Docker Hub repositories are unavailable.
Keep Bitnami's default startup scripts and mount data at `/bitnami/minio/data`. The readiness check
uses `curl`, which is included in this image. The non-root init client writes its configuration to
`/tmp/.mc`; `minio-init` waits for health and idempotently creates bucket `lotse`.
Postgres starts after that job succeeds, so Compose's `--wait` recognizes the
one-shot service and waits for its successful exit as well as both service healthchecks.
The credentials in Compose and `.env.example` are local development values.

Parallel checkouts can each use their own database on the same `db` service, injected through
`DATABASE_URL`; do not change the default database or role. Real-service tests create
a unique `lotse_test_<uuid>` database using the configured URL's server and role, assert that it is
empty, migrate it and drop only that database afterward. This needs `CREATEDB` in development.
MinIO tests use unique prefixes so parallel test runs can share the bucket without sharing object keys.

## Sources

- [Drizzle vector indexes](https://orm.drizzle.team/docs/guides/vector-similarity-search)
- [Drizzle generated columns](https://orm.drizzle.team/docs/generated-columns)
- [Drizzle custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)
- [postgres.js connection options](https://github.com/porsager/postgres#connection)
- [Cloudflare R2 with AWS SDK v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/)
- [Docker Compose dependency health](https://docs.docker.com/compose/how-tos/startup-order/)
- [Bitnami MinIO configuration](https://github.com/bitnami/containers/tree/main/bitnami/minio)
