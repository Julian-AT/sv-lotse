---
id: WP-155
title: Office directory for carrier Landesstellen and service centres
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101, WP-176]
fr: [FR-O1, E2]
owns:
  - packages/knowledge/offices/carriers/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge catalog:load
  - bun run --filter @lotse/knowledge e2:scan
  - bun run --filter @lotse/knowledge test
pr_title: "feat(data): add carrier office directory"
---

# WP-155: Office directory for carrier Landesstellen and service centres

## Goal

Curate the offices of the social-insurance carriers: ÖGK (all nine Landesstellen and their customer
service centres), SVS, BVAEB, PVA (Landesstellen) and AUVA (Landesstellen). One YAML file per office
with name, carrier, federal state, address, phone, e-mail or contact form URL, opening hours where
published, the services or benefit areas it handles where the source says so, and sources. Ids are
stable, lower-case and descriptive (for example `oegk-wien`). Office rules in benefit records
(WP-151 and later) will reference these ids, so cover every carrier and state.

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

- [ ] AC1: Every ÖGK Landesstelle and every PVA Landesstelle has a record; SVS, BVAEB and AUVA have at
  least their head office and state offices where published.
- [ ] AC2: `catalog:load` loads all records into real Postgres; `e2:scan` passes.
- [ ] AC3: Report lists every URL checked with its quote.

## Suggested commits

- `feat(data): add carrier office directory`
