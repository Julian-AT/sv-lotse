---
id: WP-000
title: Short imperative title
wave: W1
lane: brain
risk: normal
codex_effort: high
depends_on: [WP-000]
fr: [FR-X0]
owns:
  - packages/example/src/area/**
may_touch:
  - packages/example/package.json
  - pnpm-lock.yaml
allow_deps: none
live_services: []
gates:
  - pnpm --filter @lotse/example typecheck
  - pnpm --filter @lotse/example test
pr_title: "feat(brain): short conventional title"
---

# WP-000: Short imperative title

## Goal

One paragraph: what exists after this WP that did not exist before, and why it matters for the product.

## Context

- PRD: section numbers and FR/NFR IDs to read (for example "§8 Tools, FR-G3, NFR-4").
- Builds on: modules and contracts from earlier WPs, with paths.
- Constraints and decisions already taken (ADRs) that apply.

## Scope

In scope:
- ...

Out of scope (other WPs own these):
- ...

## Deliverables

1. ...

## Acceptance criteria

Each criterion is proven by a named test or a gate. Tests run against real Postgres and MinIO, and
against the services in `live_services`.

- [ ] AC1: ...
- [ ] AC2: ...

## Notes for the implementer

- API details to check in current docs, pitfalls, performance or security considerations.

## Suggested commits

- `feat(scope): ...`
- `test(scope): ...`
