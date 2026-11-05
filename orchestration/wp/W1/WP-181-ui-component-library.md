---
id: WP-181
title: Workspace UI component library with tokens and accessible components
wave: W1
lane: ui
risk: normal
codex_effort: high
depends_on: [WP-001]
fr: [NFR-5, FR-L1, FR-K1, FR-P3, FR-G4]
owns:
  - packages/ui/**
may_touch:
  - bun.lock
allow_deps: "`@testing-library/react`, `@testing-library/user-event`, `jsdom`, `vitest-axe` (or `axe-core`), `clsx`; `lucide-react` for icons"
live_services: []
gates:
  - bun run --filter @lotse/ui typecheck
  - bun run --filter @lotse/ui test
pr_title: "feat(ui): add workspace design tokens and accessible components"
---

# WP-181: Workspace UI component library

## Goal

A clean, accessible React component library in `@lotse/ui` that the workspace (WP-007, WP-112,
WP-121, WP-201) builds on, so those WPs compose screens instead of styling from scratch. Calm,
trustworthy public-service look: large readable type, generous spacing, strong contrast, plain
language, German first.

## Context

- PRD §6 experience design, §17 `packages/ui` invariants (WCAG 2.2 AA checks in component tests,
  44-point targets), FR-L1 (languages, simple language), FR-K1 journey map, FR-P3 fact confirmation,
  FR-G4 Why panel and citations.
- React 19 is a peer dependency (WP-001). No Next.js imports: plain React components.

## Deliverables

1. **Design tokens** (`src/tokens/`): colour (light and dark, AA contrast), type scale, spacing,
   radius, elevation, focus ring, motion (respecting `prefers-reduced-motion`), as CSS custom
   properties plus typed TypeScript constants. One stylesheet `@lotse/ui/styles.css`.
2. **Primitives**: Button (primary, secondary, ghost, danger; loading), IconButton, Link, Card,
   Stack/Inline layout, Heading, Text, Badge, Tag, Alert (info, success, warning, error), Dialog,
   Tooltip, Tabs, Disclosure, Field (label, hint, error), TextInput, Select, Checkbox, Radio, Spinner,
   Skeleton, VisuallyHidden.
3. **Domain components** (presentational, props in, events out; no data fetching):
   - `ConversationBubble` (user and assistant, streaming text, citations as chips);
   - `CitationChip` and `WhyPanel` (sources with quote, URL and as-of date);
   - `ApprovalCard` (what will change, provenance list, approve / decline, keyboard and voice hints);
   - `FactCard` (value, source chip, confirm / edit / reject; draft and confirmed states);
   - `JourneyMap` (steps with status, owner, due date, "prepared by the pilot, waiting for you");
   - `DocumentChecklist` (have / missing / obtainable with where to obtain);
   - `SafetyNotice` (emergency numbers, fixed text from props, never generated);
   - `FormFieldOverlay` (positioned box with draft / confirmed state and source chip) for the viewer.
4. **Copy**: no hard-coded user text in components except accessible defaults passed through a small
   `labels` prop with German defaults in one `src/copy/de.ts` (English in `src/copy/en.ts`).
5. **Tests**: Vitest with Testing Library and jsdom; an axe check for every component; keyboard
   tests for Dialog, Tabs, ApprovalCard; 44-point minimum target size on interactive elements.
6. **Docs**: `packages/ui/README.md` with usage per component; update `AGENTS.md`.

## Acceptance criteria

- [ ] AC1: Every component renders, has an axe test with zero violations and a behaviour test.
- [ ] AC2: ApprovalCard and FactCard are fully operable by keyboard; Dialog traps focus and restores it.
- [ ] AC3: Tokens meet AA contrast in light and dark (test computes ratios).
- [ ] AC4: No user-facing string literal in component files outside `src/copy/` (static test).

## Suggested commits

- `feat(ui): add design tokens and primitives`
- `feat(ui): add conversation, approval, fact and journey components`
- `test(ui): add accessibility and keyboard tests`
