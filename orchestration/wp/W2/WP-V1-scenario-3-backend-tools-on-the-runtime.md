---
id: WP-V1
title: Scenario 3 backend tools on the runtime
wave: W2
lane: brain
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-014, WP-151, WP-155, WP-156]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - packages/brain/src/engine/**
  - packages/brain/src/geo/**
  - packages/brain/src/tools/impl/process/**
  - packages/brain/src/tools/impl/case/**
  - packages/brain/src/tools/impl/documents/**
  - packages/brain/src/tools/impl/handoff/**
  - packages/brain/src/tools/impl/office/**
  - packages/brain/src/tools/impl/facility/**
  - packages/brain/src/tools/impl/appointment/**
  - packages/brain/src/tools/impl/eko/**
  - packages/brain/src/tools/impl/fees/**
  - packages/brain/src/tools/impl/catalog/**
  - packages/brain/test/engine/**
  - packages/brain/test/v1/**
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
pr_title: "feat(brain): run the scenario 3 process tools on the runtime"
---

# WP-V1: Scenario 3 backend tools on the runtime

## Goal and deliverables

Implement and register on the WP-006 registry (replacing the stubs) everything the scenario 3 flow
needs before forms: `catalog.findBenefits`, `catalog.getBenefit`, the process engine (pure TS, PRD §8
"Process engine") with `process.start`, `process.nextStep`, `process.applyAnswers`,
`process.completeStep` (creates next steps and reminders, FR-K5), `office.resolve` (office_rules over
the WP-155/156 directory), `facility.search` (rehabilitation facilities from the catalog or a
facility seed you add under `packages/knowledge/facilities/` with sources), `appointment.search` and
`appointment.prepare` (call sheet, e-mail draft, `.ics`), `documents.checklist`, `case.update`,
`reminder.create`, `eko.lookupCoverage` and `fees.explainReimbursement` (wrapping the WP-153/154
loaders). Catalog and processes come from Postgres (`catalog:load`). Supersedes WP-102, WP-116,
WP-117, WP-118, WP-172 and the non-form part of WP-180.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Also

Write append-only `audit_event` rows for every state-changing tool in the groups you own (finding
from the WP-006 review).

## Acceptance criteria

- [ ] AC1: A scripted scenario 3 sequence of tool calls (find benefits for the discharge-letter facts,
  start rehabilitation, resolve the office for an ÖGK pensioner in Styria, find facilities, prepare an
  appointment, checklist) passes against real Postgres with the loaded catalog.
- [ ] AC2: Engine unit tests cover next-question choice and step completion (E1).
- [ ] AC3: No stub branch remains for these tools (test with BRAIN_ALLOW_STUBS unset).

## Suggested commits

- `feat(brain): run the scenario 3 process tools on the runtime`
