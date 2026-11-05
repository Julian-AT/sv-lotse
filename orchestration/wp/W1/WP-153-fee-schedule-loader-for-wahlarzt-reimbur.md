---
id: WP-153
title: Fee schedule loader for Wahlarzt reimbursement
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101]
fr: [FR-M2]
owns:
  - packages/knowledge/src/loaders/fees/**
  - packages/knowledge/test/loaders/fees/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: "`pdfjs-dist` (latest stable, legacy Node build) in `@lotse/knowledge`"
live_services: []
gates:
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test -- test/loaders/fees
pr_title: "feat(knowledge): add fee schedule loader for wahlarzt reimbursement"
---

# WP-153: Fee schedule loader for Wahlarzt reimbursement

## Goal

Parse the ÖGK fee schedule for contract doctors in Styria (147 pages, positions with euro amounts, as of 1 January 2025) and the dental fee schedule 2026 from `data/svbox/Leistungskataloge/` into typed positions (code, title, amount, unit, section, region, as-of date, page). Provide `explainReimbursement({ position, paidAmount })` that returns the contract tariff and the 80% reimbursement rule with the amounts labelled illustrative, with region and as-of date. Extract the text layer with a library available in the baseline or `pdfjs-dist` (allowed); document the layout you derived. The Wahlarzt catalog record and the `fees.explainReimbursement` tool are later WPs.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary; requirement IDs above.
- Built on WP-101 (`packages/knowledge` schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation sets,
  WP-111 (`packages/evals` harness).
- Data-only W1b work package: many run in parallel, so stay strictly inside the owned paths.


## Acceptance criteria

- [ ] AC1: At least 95% of fee positions parse; a sample of 15 positions matches the PDF (code, title,
  amount, page).
- [ ] AC2: `explainReimbursement` returns tariff, 80% amount, region and as-of date, labelled illustrative.
- [ ] AC3: Dental schedule positions parse with the same shape.

## Suggested commits

- `feat(knowledge): add fee schedule loader for wahlarzt reimbursement`
