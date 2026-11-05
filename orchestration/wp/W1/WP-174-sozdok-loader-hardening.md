---
id: WP-174
title: SozDok loader hardening for paragraph chunks and partial reloads
wave: W1
lane: knowledge
risk: normal
codex_effort: high
depends_on: [WP-166]
fr: [FR-G4, E6]
owns:
  - packages/knowledge/src/loaders/sozdok/**
  - packages/knowledge/test/loaders/sozdok/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/knowledge typecheck
  - bun run --filter @lotse/knowledge test
  - bun run --filter @lotse/knowledge test:db
pr_title: "fix(knowledge): keep sozdok chunks within paragraphs on reload"
---

# WP-174: SozDok loader hardening

## Goal

WP-166 landed the SozDok loader after three attempts; its last Codex cross-review found the issues
below. Fix both with the regression tests they name, keeping all existing tests green. Retrieval
(WP-104) depends on this WP.

## Findings to fix (from the WP-166 cross-review)

1. **major — Chunks cross legal paragraph boundaries.** [chunk.ts:52](packages/knowledge/src/loaders/sozdok/chunk.ts:52)

   Units are combined solely by size. The real file `FamHospKarVertrag_AMS=PARA=1-4==2002-12-09=2003-01-01.xml` produces one chunk containing §§ 1–4. This violates AC3 and prevents paragraph-specific citation metadata. The current AC3 test only compares chunks against the same file-level record.

   **Required change:** Preserve provision boundaries from the XML, flush chunks whenever the legal paragraph changes, and assign the corresponding paragraph number and citation. Add a regression using this real file that independently verifies those boundaries.

2. **major — Partial reloads discard known successor dates.** [load.ts:94](packages/knowledge/src/loaders/sozdok/load.ts:94)

   Known end dates are retained only for the same `dokid`. First load versions starting in 1996 and 2010 with `--on 2000-01-01`: only the 1996 source is persisted, ending in 2010. Then load a subset containing an intermediate 2005 version. Reconciliation changes the predecessor’s end to 2005 but gives the intermediate version a null end, losing the known 2010 transition. Superseded legal text can consequently remain retrievable indefinitely.

   **Required change:** Reconcile known transition dates across the entire provision, including successor dates retained only in persisted `in_force_to` values. Preserve the intermediate version’s 2010 end and add a real-Postgres regression for this sequence.

## Acceptance criteria

- [ ] AC1: Each finding is fixed and proven by its regression test (real SV-Box files where named).
- [ ] AC2: All WP-166 tests stay green; all gates pass.

## Suggested commits

- `fix(knowledge): keep sozdok chunks within paragraphs on reload`
