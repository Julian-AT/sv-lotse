---
id: WP-151
title: Medical rehabilitation and Anschlussheilverfahren
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101, WP-155, WP-156]
fr: [FR-G1, FR-G5, E2]
owns:
  - packages/knowledge/catalog/medical-rehabilitation*
  - packages/knowledge/processes/medical-rehabilitation*
may_touch: []
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge catalog:load
  - bun run --filter @lotse/knowledge e2:scan
  - bun run --filter @lotse/knowledge test
pr_title: "feat(data): add medical rehabilitation and anschlussheilverfahren"
---

# WP-151: Medical rehabilitation and Anschlussheilverfahren

## Goal

Medical rehabilitation including the Anschlussheilverfahren (PRD §10 core set, area C): responsible carrier by insurance status (PVA, SVS, BVAEB, accident carrier) with forwarding, the prescribed form completed by treating or hospital doctors, the hospital requesting an Anschlussheilverfahren, Kur versus rehabilitation, co-payments. Scenario 3 depends on it.

For each benefit: a catalog record (`catalog/<id>.yaml`) with all PRD §10 fields that the sources
support (criteria with conditions over slots where machine-checkable, `office_rules` referencing the
office directory ids from WP-155/WP-156, documents with `obtain_from`, forms as `ref:forms/...` where a
registered template exists or a `{ search, publisher }` hint otherwise, appointment channels) and a
process definition (`processes/<id>.yaml`) with steps, slots and their questions, transitions,
outputs and reminders, so the process engine (WP-102) can run it. Ids are stable, lower-case,
descriptive.

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

## Acceptance criteria

- [ ] AC1: Records validate and every `ref:` resolves (`catalog:load` into real Postgres); `e2:scan` passes.
- [ ] AC2: Each criterion has a source quote; legal bases cite SozDok paragraphs where the source names them.
- [ ] AC3: Report lists every URL checked with its quote.

## Suggested commits

- `feat(data): add medical rehabilitation and anschlussheilverfahren`
