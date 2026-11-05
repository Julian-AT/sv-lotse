---
id: WP-176
title: Catalog review state and office fields in the knowledge schemas
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-101]
fr: [NFR-13, FR-O1, FR-D10]
owns:
  - packages/knowledge/src/schemas/**
  - packages/knowledge/test/schemas/**
  - packages/knowledge/offices/README.md
  - packages/knowledge/forms/README.md
  - packages/knowledge/catalog/README.md
  - packages/knowledge/facilities/README.md
may_touch: []
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge catalog:load
  - bun run --filter @lotse/knowledge e2:scan
pr_title: "feat(knowledge): allow records awaiting review and office fields"
---

# WP-176: Catalog review state and office fields in the knowledge schemas

## Goal

The W1b data WPs must not invent a human verification date: records are written by agents from
sources and verified by a person later (PRD §10 curation loop: extraction proposes, a reviewer
approves). The WP-101 schemas require `verified_at` on offices and `status: verified` with a date on
repository form schemas, and the office schema lacks fields the briefs ask for. Make the review state
explicit and additive.

## Deliverables

1. `verified_at` is optional on every record kind; a record without it is "awaiting review". Keep the
   date format when present.
2. Repository form schemas accept `status: "auto"` (candidate, no `verified_at`) or
   `status: "verified"` (with `verified_at`), matching the PRD §10 template states.
3. `Office` gains optional `name_simple` and optional `opening_hours` (structured per weekday with
   free-text notes, quoted from the source).
4. The loader and `catalog:load` report the number of records awaiting review per kind (console
   summary); nothing else changes in loader behaviour.
5. Update the data-folder READMEs: how review state works and an example of each.

## Acceptance criteria

- [ ] AC1: A record without `verified_at` validates; a malformed date still fails (tests).
- [ ] AC2: A form schema with `status: auto` and no date validates; `status: verified` without a date
  fails (tests).
- [ ] AC3: Offices with `name_simple` and opening hours validate (tests); existing fixtures still pass.

## Suggested commits

- `feat(knowledge): allow records awaiting review and office fields`
