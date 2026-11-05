---
id: WP-184
title: E4 S3 scenario suite
wave: W1
lane: evals
risk: normal
codex_effort: high
depends_on: [WP-111]
fr: [E4, FR-G5]
owns:
  - packages/evals/sets/e4/s3/**
  - packages/evals/test/sets/e4/s3/**
may_touch:
  - bun.lock
allow_deps: none beyond what the brief names; deadline mode, document deviations
live_services: []
gates:
  - bun run --filter @lotse/evals typecheck
  - bun run --filter @lotse/evals test -- test/sets/e4/s3
pr_title: "test(evals): add e4 s3 after hospital scenario suite"
---

# WP-184: E4 S3 scenario suite

## Goal and deliverables

Write the E4 suite for scenario S3 "After hospital" (PRD §3 core scenarios, §14 E4): the persona starts
with "I got a discharge letter. What do I have to do now?". Expected outcome: document import and quote extraction, medical rehabilitation process, responsible office, live form filling, document checklist, facility search, appointment preparation, prescription-fee exemption, EKO check of discharge medication. Focus: the SV-Box discharge letter.

Deliverables, using the WP-111 harness (`Suite`, `Case`, persona spec, rubric YAML):
1. 20 persona variants (language German and English, simple language, dialect and colloquial
   phrasing, helper asking, missing information, contradictory information, voice-and-captions-only
   style where it applies), each with the facts the persona knows and the goal.
2. A versioned rubric (`rubric.v1.yaml`) with binary or three-point criteria and written anchors:
   goal correctly confirmed, correct benefits identified, correct office, complete document list,
   number of questions against the minimum, correct next action, tone and language level, citations
   present, medical boundary respected.
3. Expected outcomes per variant as references to catalog ids where they exist (benefits, offices,
   forms) and plain descriptions otherwise; sources for every expectation.
4. A loader test validating every case, the rubric schema and the variant coverage.

## Context

- PRD sections for the requirement IDs above; `AGENTS.md` (code quality standard, deadline mode).

## Acceptance criteria

- [ ] AC1: 20 variants covering the listed dimensions; loader test passes.
- [ ] AC2: Rubric validates against the WP-111 rubric schema.
- [ ] AC3: No expected answer contains medical advice (manual review noted in the report).

## Suggested commits

- `test(evals): add e4 s3 after hospital scenario suite`
