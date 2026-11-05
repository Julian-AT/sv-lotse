---
id: WP-154
title: EKO loader for medicine coverage with substance-level lookup
wave: W1
lane: knowledge
risk: normal
codex_effort: medium
depends_on: [WP-101]
fr: [FR-M1]
owns:
  - packages/knowledge/src/loaders/eko/**
  - packages/knowledge/test/loaders/eko/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test -- test/loaders/eko
pr_title: "feat(knowledge): add eko loader with substance-level coverage lookup"
---

# WP-154: EKO loader for medicine coverage with substance-level lookup

## Goal

Parse the Erstattungskodex export in `data/svbox/Medikamenten Erstattungskodex/`: `medikament.txt`
(fixed-width, Windows-1252: pharma number, name, box, pack size, price, codes such as IND or L3),
`regeltext.txt` and `indtext.txt` (pipe-delimited rule and indication texts per pharma number; the
`_v2` files are UTF-8 with HTML entities), and `atccode.txt`. Use `Zeichenerklärungen und
Abkürzungen.pdf` to document the codes. Provide `loadEko(dir)` returning typed packs and
`lookupCoverage({ query })` that answers by product or substance: listed or not, box (green, yellow
RE1, yellow RE2, red), approval requirement, the rule text quoted verbatim and prescription-fee rules.
PRD boundary: ATC codes and indication texts never leave the loader's internal index (they may be used
to group by substance but are not returned). The `eko.lookupCoverage` tool wrapper is a later WP.
Decode Windows-1252 correctly (umlauts) and document the fixed-width layout you derived.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary; requirement IDs above.
- Built on WP-101 (`packages/knowledge` schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation sets,
  WP-111 (`packages/evals` harness).
- Data-only W1b work package: many run in parallel, so stay strictly inside the owned paths.


## Acceptance criteria

- [ ] AC1: All packs in `medikament.txt` parse; a sample of 10 named packs matches the raw file values.
- [ ] AC2: `lookupCoverage` returns box, approval requirement and verbatim rule text for known products and
  for a substance query; results never contain ATC codes or indication text (test).
- [ ] AC3: Umlauts decode correctly (test on a known product name).

## Suggested commits

- `feat(knowledge): add eko loader with substance-level coverage lookup`
