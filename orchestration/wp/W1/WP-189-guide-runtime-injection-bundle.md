---
id: WP-189
title: Guide runtime injection bundle
wave: W1
lane: guide
risk: normal
codex_effort: high
depends_on: [WP-171]
fr: [FR-D7, FR-C3]
owns:
  - packages/guide/build/**
  - packages/guide/test/bundle/**
may_touch:
  - packages/guide/package.json
  - bun.lock
allow_deps: none beyond what the brief names; deadline mode, document deviations
live_services: []
gates:
  - bun run --filter @lotse/guide typecheck
  - bun run --filter @lotse/guide test
  - bun run --filter @lotse/guide build:bundle
pr_title: "build(guide): bundle the guide runtime for page injection"
---

# WP-189: Guide runtime injection bundle

## Goal and deliverables

Produce a single self-contained IIFE bundle of the guide runtime (`dist/guide.iife.js`) for injection
as a `WKUserScript` into the guided portal window and as a script in the web workspace: exposes one
global entry (`window.__lotseGuide`) with `createGuide`, no network access, deterministic output, size
budget documented. Script `build:bundle` (esbuild or Bun's bundler); a Playwright test loads the
bundle into a fixture page and runs a snapshot and a `point` action through the global.

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Acceptance criteria

- [ ] AC1: Bundle builds deterministically (two builds byte-identical).
- [ ] AC2: Playwright test drives the bundle through the global entry.

## Suggested commits

- `build(guide): bundle the guide runtime for page injection`
