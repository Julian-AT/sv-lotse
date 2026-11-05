---
id: WP-014
title: Switch knowledge and web to @lotse/db and remove the brain shims
wave: W1
lane: db
risk: normal
codex_effort: high
depends_on: [WP-013, WP-103, WP-166, WP-170, WP-005]
fr: [NFR-13]
owns:
  - packages/knowledge/src/loader/db.ts
  - packages/knowledge/src/ingest/indexer.ts
  - packages/knowledge/src/loaders/sozdok/load.ts
  - apps/web/src/server/**
may_touch:
  - packages/knowledge/package.json
  - apps/web/package.json
  - packages/brain/package.json
  - bun.lock
  - packages/brain/src/db/**
  - packages/brain/src/storage/**
allow_deps: none beyond the baseline; anything else needs a contract change request
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run typecheck
  - bun run test
  - bun run --filter @lotse/knowledge test:db
  - bun run --filter @lotse/knowledge e2:scan
pr_title: "refactor(db): import @lotse/db directly and drop brain db shims"
---

# WP-014: Switch knowledge and web to @lotse/db and remove the brain shims

## Goal and deliverables

Finish the WP-013 move: replace every `@lotse/brain/db*` and `@lotse/brain/storage/*` import in
`packages/knowledge` and `apps/web` with `@lotse/db`, drop the `@lotse/brain` dependency from
`@lotse/knowledge`, delete the brain's re-export shims and delegating scripts, and update briefs-facing
docs (package AGENTS.md files). Search the whole repository for remaining imports first; the owned
paths above are the expected sites, and a site elsewhere is a contract change request.

## Context

- PRD sections for the requirement IDs above (§8 agent design and tools, §10 data, §14 evaluation,
  §4 boundaries); `AGENTS.md` at the root and in the packages you touch.

## Acceptance criteria

Each criterion is proven by a named test or gate against real services.

- [ ] AC1: No `@lotse/brain/db` or `@lotse/brain/storage` import remains (static test or grep gate).
- [ ] AC2: `@lotse/knowledge` does not depend on `@lotse/brain`.
- [ ] AC3: All gates pass.

## Suggested commits

- `refactor(db): import @lotse/db directly and drop brain db shims`
