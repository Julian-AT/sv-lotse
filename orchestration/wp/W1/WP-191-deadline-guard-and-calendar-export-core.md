---
id: WP-191
title: Deadline guard and calendar export core
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-013]
fr: [FR-K2, FR-D8]
owns:
  - packages/brain/src/deadlines/**
  - packages/brain/test/deadlines/**
may_touch:
  - packages/brain/package.json
  - bun.lock
allow_deps: none beyond what the brief names; deadline mode, document deviations
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/db db:migrate
  - bun run --filter @lotse/brain typecheck
  - bun run --filter @lotse/brain test
  - bun run --filter @lotse/db test:integration
pr_title: "feat(brain): add deadline guard with reminders and calendar export"
---

# WP-191: Deadline guard and calendar export core

## Goal and deliverables

Implement the deadline guard core (FR-K2): extract dated obligations from confirmed facts and
case steps, create `reminder` rows with source quotes, compute what is due or overdue for a case, and
export reminders as RFC 5545 `.ics` (stable UIDs, Europe/Vienna time zone). Export as
`@lotse/brain/deadlines`. No tool registration (WP-180).

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Acceptance criteria

- [ ] AC1: Reminders are created once per obligation (idempotent, real Postgres).
- [ ] AC2: `.ics` output validates with an RFC 5545 parser in the test; Vienna DST handled.

## Suggested commits

- `feat(brain): add deadline guard with reminders and calendar export`
