---
id: WP-156
title: Office directory for FSW, district authorities and Finanzamt
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101, WP-176]
fr: [FR-O1, E2]
owns:
  - packages/knowledge/offices/regional/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge catalog:load
  - bun run --filter @lotse/knowledge e2:scan
  - bun run --filter @lotse/knowledge test
pr_title: "feat(data): add regional office directory"
---

# WP-156: Office directory for FSW, district authorities and Finanzamt

## Goal

Curate regional offices outside the carriers: Fonds Soziales Wien (service centres and the care and
support hotline), the Vienna Magistratische Bezirksämter relevant for social matters, the Styrian
Bezirkshauptmannschaften and the Graz Sozialamt (scenario regions), and the Finanzamt Österreich
contact points for Familienbeihilfe. Same record shape as the carrier directory (see the offices
README). Prefer the official contact page of each office.

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

- [ ] AC1: FSW service centres, Vienna district offices for social matters, all Styrian
  Bezirkshauptmannschaften and the Finanzamt Österreich contact points have records.
- [ ] AC2: `catalog:load` loads all records; `e2:scan` passes.
- [ ] AC3: Report lists every URL checked with its quote.

## Suggested commits

- `feat(data): add regional office directory`
