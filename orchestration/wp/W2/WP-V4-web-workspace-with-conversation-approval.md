---
id: WP-V4
title: Web workspace with conversation, approvals and live form viewer
wave: W2
lane: workspace
risk: normal
codex_effort: xhigh
depends_on: [WP-006, WP-181, WP-188]
fr: [FR-D5, FR-G3, FR-O1, FR-A2]
owns:
  - apps/web/src/app/(workspace)/**
  - apps/web/src/conversation/**
  - apps/web/src/features/**
  - apps/web/src/bridge/**
  - apps/web/e2e/workspace/**
  - packages/ui/**
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
pr_title: "feat(workspace): add conversation, approvals and live form viewer"
---

# WP-V4: Web workspace with conversation, approvals and live form viewer

## Goal and deliverables

Build the workspace the user sees (and the Mac app embeds): `useChat` against `/api/turn` sending
only the latest message, rendering text, citations (`CitationChip`, `WhyPanel`), `SafetyNotice`,
`ApprovalCard` answering `tool-approval-request` with `addToolApprovalResponse`, journey map
(`JourneyMap` from case events), fact confirmation cards (`FactCard` via `/api/facts`), document
upload, and the PDF form viewer: pdf.js rendering with the `FormFieldOverlay` per field, draft and
confirmed states, source chips, and an in-page typing animation for `type` actions (pace from the
payload). Client tools run in the page; the bridge adapter forwards actions, speech segments and OS
tools to the Mac when embedded (`window.webkit.messageHandlers.lotse`), using `@lotse/protocol`
envelopes. Copy from the WP-188 catalogs; components from `@lotse/ui` (extend it here if needed).
Supersedes WP-007, WP-112 and WP-121.

## Deadline mode (owner, 2026-11-06)

This is a vertical slice for the scenario 3 demo, about 6 hours before the deadline. Make it work end
to end against real services, cleanly but without gold-plating: no new abstractions beyond what the
slice needs, reuse what exists on main, document deviations in the report and keep going. Code quality
standard and safety rules in AGENTS.md still apply (no secrets, approvals server-side, medical
boundary, no hard-coded domain data).

## Acceptance criteria

- [ ] AC1: Playwright: a turn renders streamed text with a citation; an approval card approves a pending
  tool call; the form viewer shows typed drafts and a confirmed state (real brain, live OpenAI).
- [ ] AC2: The bridge adapter sends protocol-valid envelopes (unit test with Zod).

## Suggested commits

- `feat(workspace): add conversation, approvals and live form viewer`
