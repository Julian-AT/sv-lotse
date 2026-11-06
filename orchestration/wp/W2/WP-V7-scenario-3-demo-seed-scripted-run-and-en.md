---
id: WP-V7
title: Scenario 3 demo seed, scripted run and end-to-end test
wave: W2
lane: evals
risk: normal
codex_effort: xhigh
depends_on: [WP-V1, WP-V2, WP-V3, WP-V4]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - scripts/demo/**
  - apps/web/e2e/demo/**
  - packages/evals/sets/e4/s3-demo/**
  - docs/demo/**
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
pr_title: "feat(evals): add the scenario 3 demo seed, script and e2e"
---

# WP-V7: Scenario 3 demo seed, scripted run and end-to-end test

## Goal and deliverables

Make the demo reproducible: `scripts/demo/seed.ts` migrates, loads the catalog, indexes the
scenario sources and creates a demo subject; `scripts/demo/run.md` is the click-and-say script
(discharge letter upload → recommendation highlighted → rehabilitation confirmed → office → live
form filling with approval → checklist → facility → appointment → journey map); a Playwright E2E
runs the same flow in the browser against live OpenAI. Supersedes WP-204.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: `bun scripts/demo/seed.ts` prepares a clean database in under 2 minutes.
- [ ] AC2: The demo E2E passes end to end in the browser (live).

## Suggested commits

- `feat(evals): add the scenario 3 demo seed, script and e2e`
