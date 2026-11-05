---
id: WP-163
title: E12 extraction gold annotations for SV-Box documents
wave: W1
lane: evals
risk: normal
codex_effort: medium
depends_on: [WP-111]
fr: [E12, FR-D2, FR-P1]
owns:
  - packages/evals/sets/e12/**
  - packages/evals/test/sets/e12/**
may_touch:
  - bun.lock
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e12
pr_title: "test(evals): add e12 extraction gold annotations"
---

# WP-163: E12 extraction gold annotations for SV-Box documents

## Goal

Annotate the 5 SV-Box documents in `data/svbox/Befunde/` for E12: documented recommendations and
administrative facts (for example the rehabilitation recommendation, follow-up appointments,
social-insurance hints, open tasks, issuing institution, dates, vaccination entries) with the verbatim
quote, page and position (bounding box normalized 0..1 or text offsets on the PDF text layer), and the
fact type. Never annotate interpretations: findings text is not extracted as a fact, only documented
recommendations and administrative items. Add 10 synthetic discharge letters and reports (clearly
labelled synthetic, varied layout and wording, no real persons) with the same annotations.

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

- [ ] AC1: All 5 SV-Box documents and 10 synthetic documents annotated; each annotation has quote, page
  and position.
- [ ] AC2: The loader test validates all annotations and that each quote occurs in the document text
  (PDF text layer for SV-Box files).
- [ ] AC3: No annotation contains an interpretation of findings.

## Suggested commits

- `test(evals): add e12 extraction gold annotations`
