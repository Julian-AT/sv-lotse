---
id: WP-173
title: Ingestion normalization hardening
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-103]
fr: [E3, NFR-15]
owns:
  - packages/knowledge/src/ingest/**
  - packages/knowledge/test/ingest/**
may_touch:
  - packages/knowledge/package.json
  - bun.lock
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
pr_title: "fix(knowledge): harden ingestion normalization"
---

# WP-173: Ingestion normalization hardening

## Goal

WP-103 landed the ingestion pipeline after three attempts; its last Codex cross-review found the
normalization issues below. Fix every one with the regression test it names, keeping all existing
tests green. Retrieval (WP-104) depends on this WP.

## Findings to fix (from the WP-103 cross-review)

1. **major — [indexer.ts:109](packages/knowledge/src/ingest/indexer.ts:109): Section validity never reaches the index.**  
   Every chunk receives the document’s global dates. The existing seasonal-section fixture states `Gültig bis: 31.08.2025`, but its chunks receive null validity. Retrieval therefore cannot exclude that expired information as required by PRD §10. **Required change:** preserve section-scoped dates through normalization and enrichment, write each chunk’s applicable validity, and add a database regression proving expired seasonal chunks are excluded while unrelated contact chunks remain valid.

2. **major — [normalize.ts:180](packages/knowledge/src/ingest/normalize.ts:180): Table captions are silently discarded.**  
   The replacement renders only rows, dropping `<caption>` content. Reproduction with a caption stating “Nur für Versicherte ab 18 Jahren” retains the payment amount but removes its eligibility qualification. Caption-only changes also leave the content hash unchanged. **Required change:** retain normalized captions alongside their tables, keep that context together during chunking, and test that caption changes affect the indexed representation and hash.

3. **major — [normalize.ts:36](packages/knowledge/src/ingest/normalize.ts:36): Removing forms deletes their informational descendants.**  
   `<form><main><h1>Kontakt</h1><p>Offizielle Information</p></main></form>` normalizes to empty Markdown because forms are removed before main-content selection. Pages using a form as a layout container consequently fail ingestion; partially wrapped pages can lose substantial content during replacement. **Required change:** preserve informational descendants when removing form containers and controls, and add regression coverage for fully and partially wrapped articles.

4. **major — [normalize.ts:73](packages/knowledge/src/ingest/normalize.ts:73): Ordinary wrappers hide page-level validity labels.**  
   Only direct `p` and `time` children are inspected. A page preamble containing `<div><h1>Information</h1><p>Gültig bis: 31.08.2025</p></div>` retains the date in Markdown but produces null validity, allowing expired content through date filtering. **Required change:** inspect preamble content through neutral wrappers in document order, stopping at semantic subsection boundaries, and add a regression asserting the extracted date.

## Acceptance criteria

- [ ] AC1: Each finding is fixed and proven by its regression test.
- [ ] AC2: All WP-103 tests stay green; all gates pass.

## Suggested commits

- `fix(knowledge): harden ingestion normalization`
