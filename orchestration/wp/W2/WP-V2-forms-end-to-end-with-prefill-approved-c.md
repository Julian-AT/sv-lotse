---
id: WP-V2
title: Forms end to end with prefill, approved commit and live fill
wave: W2
lane: forms
risk: high
codex_effort: xhigh
depends_on: [WP-006, WP-014, WP-168, WP-120]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - packages/brain/src/forms/registry/**
  - packages/brain/src/forms/instances/**
  - packages/brain/src/forms/output/**
  - packages/brain/src/forms/acquire/**
  - packages/brain/src/tools/impl/form/**
  - packages/brain/src/tools/impl/form-live/**
  - packages/brain/test/forms/core/**
  - apps/web/src/app/api/forms/**
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
pr_title: "feat(forms): prefill, commit with approval and fill forms live"
---

# WP-V2: Forms end to end with prefill, approved commit and live fill

## Goal and deliverables

Implement and register `form.getSchema`, `form.prefill` (proposals with provenance from confirmed
facts; doctor, hospital and office sections never filled; IBAN only from the user's statement),
`form.fillLive` (emits one `type` action per field via data-action parts and stores drafts),
`form.commitGroup` (approval-gated: WP-006 verifies record, HMAC and input hash before execution),
`package.build` (pdf-lib, confirmed values only, AcroForm fill; flat PDFs get fields from WP-120
detection), and `form.find` / `form.acquire` for allowlisted official sites. `/api/forms/<id>/pdf`
serves the rendered PDF for the viewer. Supersedes WP-115, WP-119 and the form part of WP-180.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: Prefill of the SV-Box rehabilitation form from confirmed facts has provenance per value and empty
  non-applicant sections (real Postgres).
- [ ] AC2: `form.commitGroup` rejects a changed input and a replayed approval (tests).
- [ ] AC3: `package.build` output contains exactly the confirmed values (test reads the PDF back).

## Suggested commits

- `feat(forms): prefill, commit with approval and fill forms live`
