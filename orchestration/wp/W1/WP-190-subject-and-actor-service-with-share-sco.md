---
id: WP-190
title: Subject and actor service with share scope
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-013]
fr: [FR-P7, FR-P5]
owns:
  - packages/brain/src/subjects/**
  - packages/brain/test/subjects/**
may_touch:
  - packages/db/test/**
  - packages/db/drizzle/**
  - packages/db/src/db/schema/**
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
pr_title: "feat(brain): add subject and actor service with share scope"
---

# WP-190: Subject and actor service with share scope

## Goal and deliverables

Implement the subject and actor model (PRD §10 data model, FR-P7): create a subject (self or a
person a helper acts for), add case actors with roles (`subject`, `helper`) and a share scope,
invite a helper (single-use, expiring token stored hashed), and `factsVisibleTo(actor, subject)`
that filters facts by share scope. Subject deletion cascades (FR-P5). Export as `@lotse/brain/subjects`.
Uses `@lotse/db`. No tool registration (WP-180 does that).

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Orchestrator decision (2026-11-06)

Add a `helper_invite` table (unique token hash, case, issuer, share scope, expiry, consumed at;
cascade on case deletion) to `@lotse/db` with a generated migration (`db:generate`); the schema
freeze starts at M0, which has not been tagged.

## Acceptance criteria

- [ ] AC1: A helper sees only facts in its share scope (test against real Postgres).
- [ ] AC2: Invite tokens are single-use and expire (test).
- [ ] AC3: Deleting a subject removes its facts and cases (test).

## Suggested commits

- `feat(brain): add subject and actor service with share scope`
