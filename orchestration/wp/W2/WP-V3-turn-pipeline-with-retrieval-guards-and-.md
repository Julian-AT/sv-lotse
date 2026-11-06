---
id: WP-V3
title: Turn pipeline with retrieval, guards and segmentation
wave: W2
lane: pipeline
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-105, WP-174, WP-173, WP-V1]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - packages/brain/src/pipeline/**
  - packages/brain/src/context/**
  - packages/brain/src/retrieval/**
  - packages/brain/src/tools/impl/kb/**
  - packages/brain/test/pipeline/**
  - packages/brain/test/retrieval/**
may_touch:
  - bun.lock
  - packages/brain/package.json
  - apps/web/package.json
allow_deps: what the slice needs at the versions the repository uses; document additions
live_services: [openai]
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/db db:migrate
  - bun run typecheck
  - bun run test
  - RUN_LIVE=1 bun run test:live
pr_title: "feat(pipeline): run turns with retrieval, guards and speech segments"
---

# WP-V3: Turn pipeline with retrieval, guards and segmentation

## Goal and deliverables

Implement the PRD §8 turn pipeline around the WP-006 runtime: SR-1 safety net first (WP-105),
classify and goal confirmation (FR-G7), context assembly per the §8 budget table, hybrid retrieval
(German full-text plus pgvector with RRF, validity filter, synonyms; `kb.search` registered),
guards and citation verifier after the loop, and segmentation into `SpeechSegment` and `Action` data
parts bound to sentence indices. Index the scenario 3 sources (rehabilitation pages and the relevant
SozDok paragraphs) so answers cite real passages. Supersedes WP-104 and WP-106.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: A live scenario 3 turn on the discharge-letter facts streams a goal-confirmation question first,
  then segments with citations to indexed passages.
- [ ] AC2: SR-1 input yields the SafetyNotice before any other output (test).
- [ ] AC3: Retrieval finds a known rehabilitation passage by keyword and by paraphrase (live).

## Suggested commits

- `feat(pipeline): run turns with retrieval, guards and speech segments`
