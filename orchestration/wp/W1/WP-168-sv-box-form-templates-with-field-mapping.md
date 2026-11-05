---
id: WP-168
title: SV-Box form templates with field mappings and owner sections
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101, WP-176]
fr: [FR-D5, FR-D6, E7]
owns:
  - packages/knowledge/forms/svbox-*
  - packages/knowledge/src/loader/**
  - packages/knowledge/test/loader/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge catalog:load
  - bun run --filter @lotse/knowledge e2:scan
  - bun run --filter @lotse/knowledge test
pr_title: "feat(data): add sv-box form templates and field mappings"
---

# WP-168: SV-Box form templates with field mappings and owner sections

## Goal

Register the 7 fillable SV-Box forms in `data/svbox/Anträge und Formulare/` as verified-candidate form
schemas (`forms/svbox-<slug>.json`): rehabilitation and Kur application, Anschlussheilverfahren or
rehabilitation after an accident (hospital form), PVA Pflegegeld PAL 080, ÖGK travel-cost subsidy
Wien, FSW funding application, FSW facility wish, FSW senior shared-flat notice. For every AcroForm
field: stable `id`, `label_de` taken from the printed label next to the field (field names are often
abbreviations, so use label positions), `type`, `validation` where obvious, `fact_type` (a
descriptive snake_case fact name such as `subject_birth_date`, documented in the forms README),
`acro_field`, `owner` (`applicant`, `doctor`, `hospital`, `office`) from the section headers, and
`signature`. Hospital and doctor sections are never `applicant`. IBAN fields map to a fact the user
states; nothing is pre-filled from documents for IBAN. Read the PDFs with pdf-lib in a throwaway script
outside the repository or with the loader tests; do not commit scripts.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary; requirement IDs above.
- Built on WP-101 (`packages/knowledge` schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation sets,
  WP-111 (`packages/evals` harness).
- Data-only W1b work package: many run in parallel, so stay strictly inside the owned paths.

## Data rules (apply to every record)

- Sources: official pages of the carriers, ministries, federal states, FSW and the other origins in
  the PRD §10 source registry, or SV-Box files under `data/svbox/` (read-only). Nothing behind a
  login, no third-party summaries.
- Every record carries `sources[]` with the URL, a **verbatim German quote** that supports the
  record, and `retrieved_at`, plus `as_of`. Open each URL during your work and confirm the quote is on
  the page; list every URL you checked in the report. Never invent a fact, number, deadline, phone
  number or address; leave a field out (if optional) rather than guess.
- `verified_at` stays empty: a person verifies records later.
- Respect the schemas and the folder README files from WP-101 (`packages/knowledge/src/schemas/**`,
  `packages/knowledge/<folder>/README.md`); `catalog:load` validates everything and resolves every `ref:`.
- Medical boundary (PRD §4): no diagnosis, no assessment of findings, no therapy or medication advice;
  criteria describe administrative eligibility only.
- Simple-language names (`name_simple`) at A2 level.
- No code changes; no benefit, office or scenario id anywhere in code (E2 scan gate).

## Template registration (decision 2026-11-05)

No `form_template` rows exist yet. Extend `catalog:load` so that each repository form schema with an
SV-Box `source` path registers its template: upload the original PDF to object storage
(`@lotse/db/storage/s3`, key `forms/<id>/<sha256>.pdf`), store publisher, title, source path, hash,
page count, format `acroform`, status and the schema in `form_template`, idempotently by hash. The
schema files then reference the template by their stable `id`; `template_id` is assigned by the
loader, not hand-written. Add a database test for registration and idempotency.

## Acceptance criteria

- [ ] AC1: All 7 forms have a schema; every AcroForm widget of each PDF is mapped exactly once (count
  checked against the PDF in your report).
- [ ] AC2: Doctor and hospital sections are owned by `doctor`/`hospital`; signature fields are `signature`.
- [ ] AC3: `catalog:load` validates the schemas; `e2:scan` passes.

## Suggested commits

- `feat(data): add sv-box form templates and field mappings`
