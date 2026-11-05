---
id: WP-162
title: E3 retrieval gold questions from sources
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111]
fr: [E3, FR-G2]
owns:
  - packages/evals/sets/e3/**
  - packages/evals/test/sets/e3/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e3
pr_title: "test(evals): add e3 retrieval gold questions"
---

# WP-162: E3 retrieval gold questions from sources

## Goal

Write 200 retrieval gold questions stratified across application areas A to F (PRD §2 and §10),
written from official source pages (not from catalog records): each with id, area, question as a user
would ask it (colloquial German, some simple language and some English), the source URL, the passage
quote that answers it, and tags (carrier, region, life situation). Vary phrasing with Austrian terms
(Spital, e-card, Rezeptgebühr, Chefarzt). Open every page to copy the passage verbatim.

## Context

- PRD §10 (source registry, catalog, office directory, form registry, data sets) and §14 for
  evaluation sets; §4 medical boundary; requirement IDs above.
- Built on WP-101 (`packages/knowledge` schemas, loader, `catalog:load`, `e2:scan`) and, for evaluation sets,
  WP-111 (`packages/evals` harness).
- Data-only W1b work package: many run in parallel, so stay strictly inside the owned paths.

## Data rules

- Use the case and suite schemas of the WP-111 harness (`packages/evals/src/schema/**`); add a small
  loader test under your `test/sets/<suite>/` folder that validates every item of the set and its
  size, so the gate proves the set is well-formed.
- Gold items reference their source passage (URL or SV-Box path plus quote or position); the leakage
  check (`packages/evals/src/checks/leakage.ts`) must pass against the catalog records that exist.
- Medical boundary (PRD §4): expected answers never contain a diagnosis, an interpretation of findings,
  a risk statement or medication advice.
- Synthetic personas and texts stay inside `packages/evals` and are labelled synthetic.

## Acceptance criteria

- [ ] AC1: 200 questions, at least 25 per area A–D and at least 15 for E and F.
- [ ] AC2: Every question has a source URL and a verbatim passage; the loader test validates all.
- [ ] AC3: The leakage check passes.

## Suggested commits

- `test(evals): add e3 retrieval gold questions`
