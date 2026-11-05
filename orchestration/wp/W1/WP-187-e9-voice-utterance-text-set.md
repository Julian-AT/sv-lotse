---
id: WP-187
title: E9 voice utterance text set
wave: W1
lane: evals
risk: normal
codex_effort: high
depends_on: [WP-111]
fr: [E9]
owns:
  - packages/evals/sets/e9/**
  - packages/evals/test/sets/e9/**
may_touch:
  - bun.lock
allow_deps: none beyond what the brief names; deadline mode, document deviations
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e9
pr_title: "test(evals): add e9 voice utterance set with domain terms"
---

# WP-187: E9 voice utterance text set

## Goal and deliverables

Write the E9 text set (PRD §14): 200 utterances as users would say them, including Austrian
domain terms (Rezeptgebühr, e-card, Anschlussheilverfahren, Pflegegeld, Landesstelle, Wahlarzt,
Bewilligung, Heilbehelf, Kostenzuschuss) and numbers, dates and names, each with the reference
transcript and tags (domain term, number, date, dialect). Audio recording or synthesis is a later
step; include a generator script stub only as documentation, not code that calls a provider.

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Acceptance criteria

- [ ] AC1: 200 utterances; at least 120 with a domain term; loader test passes.

## Suggested commits

- `test(evals): add e9 voice utterance set with domain terms`
