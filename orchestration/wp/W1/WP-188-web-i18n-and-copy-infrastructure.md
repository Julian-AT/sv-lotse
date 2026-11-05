---
id: WP-188
title: Web i18n and copy infrastructure
wave: W1
lane: web
risk: normal
codex_effort: high
depends_on: [WP-005]
fr: [FR-L1, FR-L2, NFR-7]
owns:
  - apps/web/src/i18n/**
  - apps/web/test/i18n/**
may_touch:
  - apps/web/src/features/shell/copy.ts
  - apps/web/package.json
  - bun.lock
allow_deps: none beyond what the brief names; deadline mode, document deviations
live_services: []
gates:
  - bun run --filter @lotse/web typecheck
  - bun run --filter @lotse/web test
pr_title: "feat(web): add typed copy catalogs for german, english and simple"
---

# WP-188: Web i18n and copy infrastructure

## Goal and deliverables

Add the workspace copy infrastructure so no screen hard-codes text: typed message catalogs
(German `de`, English `en`, simple German `de-simple`) with one key type shared by all catalogs, a
small `t(key, params)` with ICU-style plurals and number/date formatting via `Intl`, locale
resolution (profile preference, then `Accept-Language`, default German), and a React provider and
hook. Move the existing shell copy (`apps/web/src/features/shell/copy.ts`) into the catalogs. A test
fails when a key is missing in any catalog.

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Acceptance criteria

- [ ] AC1: All catalogs have identical key sets (test).
- [ ] AC2: Shell copy comes from the catalogs.
- [ ] AC3: Formatting of dates and numbers follows the locale (test).

## Suggested commits

- `feat(web): add typed copy catalogs for german, english and simple`
