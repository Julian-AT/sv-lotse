---
id: WP-101
title: Knowledge schemas, YAML loader, catalog database load and E2 generalization scan
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-004]
fr: [FR-G5, NFR-13, E2]
owns:
  - packages/knowledge/src/schemas/**
  - packages/knowledge/src/loader/**
  - packages/knowledge/src/e2/**
  - packages/knowledge/test/schemas/**
  - packages/knowledge/test/loader/**
  - packages/knowledge/test/e2/**
  - packages/knowledge/catalog/README.md
  - packages/knowledge/processes/README.md
  - packages/knowledge/offices/README.md
  - packages/knowledge/forms/README.md
  - packages/knowledge/facilities/README.md
  - packages/knowledge/src/index.ts
  - packages/knowledge/AGENTS.md
  - packages/knowledge/README.md
may_touch:
  - packages/knowledge/package.json
  - packages/knowledge/vitest.config.ts
  - bun.lock
allow_deps: "`@lotse/brain` as `workspace:*` (only its `./db` and `./db/schema` subpath exports)"
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
  - bun run --filter @lotse/knowledge e2:scan
pr_title: "feat(knowledge): add catalog schemas, yaml loader and e2 scan"
---

# WP-101: Knowledge schemas, YAML loader, catalog database load and E2 generalization scan

## Goal

The data-first contract of the product exists: Zod schemas for benefit records, process
definitions, office and facility records, form schemas, the allowlist and source references; a
loader that reads and validates every YAML/JSON file in `packages/knowledge`, resolves `ref:`
links and loads the catalog into Postgres; and the E2 scan that fails when a benefit, scenario or
office id appears in code. After this WP, the W1b data fan-out (WP-151 to WP-169) can add records
without code changes.

## Context

- PRD §10 "Benefit catalog" (field table), "Office directory", "Generalization contract", "Form
  registry and schemas" (schema fields), "Source registry"; §14 E2; FR-G5; §17 `packages/knowledge`
  invariants (nothing without a source quote and `as_of`; YAML validated by schemas).
- Database (WP-004, `@lotse/brain/db`, `@lotse/brain/db/schema`): tables `benefit`, `office`,
  `facility`, `process` with `key`, `title`, … and a `record` jsonb; `form_template` with `schema`.
- Dependency direction: `@lotse/knowledge` may import `@lotse/brain/db*`; `@lotse/brain` never
  imports `@lotse/knowledge` (the brain reads the catalog from Postgres). Record this in AGENTS.md.

## Scope

In scope: schemas, loader, `ref:` resolution, catalog database load (idempotent upsert), E2 scan,
the directory layout with README files describing each folder, tests with small fixture records in
`test/` only.

Out of scope: real catalog content (W1b), process engine semantics (WP-102), condition expression
evaluation (WP-102; here only syntax validation), ingestion (WP-103), SozDok (WP-166).

## Deliverables

1. **Schemas** (`src/schemas/**`): `Benefit` exactly per the PRD field table (areas A–F, scopes,
   criteria with optional `condition` string and `legal_basis`, `target_group`, `office_rules`,
   `documents` with `obtain_from`, `forms` as refs or search hints, `process` ref,
   `appointment_channels`, `sources[]` with `url`, `quote`, `retrieved_at`, plus `as_of` and
   `verified_at`). `Process` (steps, slots each with type and question text, transitions, step
   outputs, reminders; enough structure for WP-102 and documented as such). `Office`, `Facility`,
   `FormSchema` (fields per PRD: `id`, `label_de`, `labels`, `help_text`, `type`, `validation`,
   `fact_type`, `acro_field` or `box`, `owner`, `signature`), `Allowlist` (origins with purpose),
   `SourceRef`. Every record requires at least one source quote and `as_of`.
2. **Loader** (`src/loader/**`): read `catalog/`, `processes/`, `offices/`, `facilities/`,
   `forms/` from the package root (path configurable for tests); YAML via `yaml`, JSON for form
   schemas; validate; resolve every `ref:<kind>/<id>` and fail with file and path on a dangling or
   wrong-kind ref; detect duplicate ids. Returns a typed, frozen `Knowledge` object.
3. **Database load** (`src/loader/db.ts`): upsert benefits, offices, facilities, processes (and
   verified form schemas into `form_template.schema` where a template exists) by `key` in one
   transaction; remove rows whose key no longer exists in the repository; idempotent. Script
   `catalog:load`.
4. **E2 scan** (`src/e2/**`, script `e2:scan`): collect all ids from the loaded knowledge and fail if
   any appears as a string literal or identifier in `packages/brain/src`, `packages/guide/src`,
   `packages/ui/src`, `apps/web/src` and `apps/mac` Swift sources (skip missing dirs). Also fail when
   `BRAIN_ALLOW_STUBS` is referenced outside the allowed build-time locations listed in its config.
   Report file and line. Exit non-zero on findings.
5. **Layout and docs**: README in each data folder describing the file format with one example;
   update `packages/knowledge/AGENTS.md` (commands, invariants, dependency direction) and README.

## Acceptance criteria

- [ ] AC1: Valid fixture records for every schema load; each invalid fixture (missing source
  quote, missing `as_of`, wrong area, dangling ref, duplicate id) fails with file and path.
- [ ] AC2: `catalog:load` against real Postgres inserts fixture records, a second run changes
  nothing, and removing a fixture removes its row (`test:db`).
- [ ] AC3: `e2:scan` passes on the current repository and fails on a temporary file containing a
  fixture benefit id (test creates it in a temp copy, never in the repo).
- [ ] AC4: No `@lotse/knowledge` import exists in `packages/brain` (static test).

## Notes for the implementer

- Keep schemas strict (`z.strictObject`) so typos in YAML fail.
- Condition strings: validate syntax with a small grammar (comparisons, `and`/`or`/`not`, slot
  names, literals); evaluation is WP-102's.

## Suggested commits

- `feat(knowledge): add catalog, process, office and form schemas`
- `feat(knowledge): add validated yaml loader and catalog database load`
- `feat(knowledge): add e2 generalization scan`
