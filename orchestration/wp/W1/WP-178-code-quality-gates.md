---
id: WP-178
title: Code quality gates with knip, dependency-cruiser, syncpack and stricter Biome
wave: W1
lane: repo
risk: normal
codex_effort: high
depends_on: [WP-010]
fr: [NFR-13]
owns:
  - knip.json
  - .dependency-cruiser.cjs
  - .dependency-cruiser-known-violations.json
  - .syncpackrc.json
  - biome.json
  - docs/adr/0178-code-quality-gates.md
  - scripts/quality/**
may_touch:
  - package.json
  - bun.lock
  - .github/workflows/ci.yml
allow_deps: "`knip`, `dependency-cruiser`, `syncpack` (latest stable) as root devDependencies"
live_services: []
gates:
  - bun install --frozen-lockfile
  - bun run quality
  - bun run verify
  - bun run format:check
  - actionlint
pr_title: "build(repo): add knip, dependency-cruiser, syncpack and stricter biome"
---

# WP-178: Code quality gates

## Goal

The owner wants clean, senior-level code. Add automated quality gates that catch dead code, unused
dependencies, architecture-boundary violations, inconsistent dependency versions and risky patterns,
without blocking the work packages that are running now: existing violations are frozen in a
baseline, and anything new fails.

## Deliverables

1. **knip** (`knip.json`) configured for the Bun workspaces (entry points per package from
   `exports`, scripts, tests, Next.js app, Playwright, Vitest): unused files, exports, dependencies
   and devDependencies. Current findings go into knip `ignore*` entries grouped with a comment
   (the baseline); new findings fail.
2. **dependency-cruiser** (`.dependency-cruiser.cjs`) with the architecture rules from ADR 0013 and
   PRD §17: `@lotse/db` imports no workspace package; `@lotse/knowledge` never imports
   `@lotse/brain` runtime code; `packages/*` never import `apps/*`; no imports of another package's
   `src/` internals except through its `exports`; no circular imports inside a package;
   `apps/mac` is out of scope. Existing violations in
   `.dependency-cruiser-known-violations.json`.
3. **syncpack** (`.syncpackrc.json`): one version per dependency across workspaces (allowing the
   documented `typescript-compiler` alias in `@lotse/knowledge`), workspace protocol for internal
   packages; fix current mismatches by aligning versions in manifests through
   `syncpack fix-mismatches` only if it changes nothing but version ranges, otherwise baseline.
4. **Biome**: enable `complexity/noExcessiveCognitiveComplexity` (max 15), `suspicious/noConsole`
   (allow in `**/cli.ts`, `scripts/**`, tests), `style/noNonNullAssertion`, `style/useImportType`,
   `style/useExportType`, `suspicious/noExplicitAny`, `correctness/noUnusedImports`,
   `correctness/noUnusedVariables`. Existing violations are suppressed per path in `biome.json`
   `overrides` (baseline), not with inline comments.
5. **Root scripts**: `quality` = knip + dependency-cruiser + syncpack lint; `verify` runs `quality`
   after lint. CI `verify` job runs it.
6. **ADR 0178**: the rules, why each tool, how the baseline is burned down (WP-179).

## Acceptance criteria

- [ ] AC1: `bun run quality` passes on main with the baseline and fails on a temporary file that
  adds an unused export, a `knowledge -> brain` import and a `console.log` (test in
  `scripts/quality/`, using a temp copy, never the real tree).
- [ ] AC2: `bun run verify`, `format:check` and actionlint pass.
- [ ] AC3: The baseline lists every suppressed finding with its path, so WP-179 can remove them.

## Suggested commits

- `build(repo): add knip, dependency-cruiser, syncpack and stricter biome`
- `ci(ci): run quality gates in verify`
- `docs(adr): record code quality gates and the baseline`
