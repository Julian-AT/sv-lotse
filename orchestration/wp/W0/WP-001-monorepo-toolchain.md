---
id: WP-001
title: Monorepo toolchain and package skeletons
wave: W0
lane: repo
risk: normal
depends_on: []
fr: [NFR-13, NFR-16]
owns:
  - package.json
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - turbo.json
  - biome.json
  - tsconfig.base.json
  - tsconfig.json
  - vitest.config.ts
  - .nvmrc
  - .npmrc
  - .editorconfig
  - .gitattributes
  - packages/**
  - docs/adr/0001-monorepo-toolchain.md
may_touch:
  - .env.example
allow_deps: baseline list in this brief
live_services: []
gates:
  - pnpm install --frozen-lockfile
  - pnpm -s verify
  - pnpm -s format:check
pr_title: "build(repo): set up pnpm workspace, turborepo and package skeletons"
---

# WP-001: Monorepo toolchain and package skeletons

## Goal

A pnpm and Turborepo monorepo in which every later work package lands into an existing package with
working lint, typecheck and test scripts. The baseline dependencies are installed once, so parallel
work packages rarely touch the lockfile.

## Context

- PRD §17: tech stack, repository layout, engineering standards, per-package `AGENTS.md` invariants.
- NFR-16: Node.js 22+, ESM only. AI SDK 7 is ESM-only.
- `apps/web` (WP-005) and `apps/mac` (WP-008) are created later. Do not create them.

## Scope

In scope: root tooling, the six package skeletons under `packages/`, package `AGENTS.md` files, the
baseline dependencies, and ADR 0001.

Out of scope: any product logic, CI (WP-002), the database (WP-004), apps.

## Deliverables

1. **Root.**
   - `package.json`: private, `"type": "module"`, `packageManager` pinned to the current pnpm,
     `engines.node >=22`.
   - `pnpm-workspace.yaml` covering `apps/*` and `packages/*`.
   - `.nvmrc` (22), `.npmrc` (`engine-strict=true`, `auto-install-peers=true`), `.editorconfig`,
     `.gitattributes` (LF; lockfile `-diff`).
2. **Turborepo.** `turbo.json` tasks:
   - `lint`, `typecheck`, `test`: cached, with inputs.
   - `test:integration` and `test:live`: not cached.
   - `build` and `generate`, with correct `dependsOn` and `outputs`.
3. **Root scripts.**
   - `verify` = `turbo run lint typecheck test`.
   - `test:integration` = `turbo run test:integration`.
   - `test:live` = `turbo run test:live`.
   - `format` = `biome format --write .`; `format:check` = `biome format .`; `lint` = `biome lint .`.
4. **Biome.** Recommended rules, formatter with two-space indent, line width 100, double quotes.
   Ignore generated folders (`**/generated/**`, `**/drizzle/**`), `.next`, `dist`, `coverage`.
5. **TypeScript.** `tsconfig.base.json`:
   - `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`;
   - `verbatimModuleSyntax`;
   - `module` and `moduleResolution` suitable for internal TS-source packages consumed by Next.js and
     Vitest (`"Bundler"`), `target` ES2023.

   Root `tsconfig.json` has project references or paths as you decide; record the decision in the ADR.
6. **Internal package strategy.** Packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`)
   with no build step. Next.js consumes them through `transpilePackages` (WP-005); Vitest and `tsx` run
   them directly. Each package has:
   - scripts `typecheck` (`tsc --noEmit`), `test` (`vitest run --passWithNoTests`) and `lint`
     (`biome lint .`);
   - a `tsconfig.json` that extends the base.
7. **Package skeletons.** `@lotse/brain`, `@lotse/protocol`, `@lotse/guide`, `@lotse/knowledge`,
   `@lotse/evals` and `@lotse/ui` in `packages/<name>`, each with:
   - `src/index.ts`;
   - a `README.md` (one paragraph on scope);
   - an `AGENTS.md` with scope, commands, invariants (copy the invariants for that package from PRD §17)
     and forbidden paths.
8. **Root Vitest.** `vitest.config.ts` with `projects` pointing at the packages.
9. **Baseline dependencies.** Install now, at the latest stable major unless pinned here:
   - root dev: `typescript`, `@biomejs/biome`, `turbo`, `vitest`, `@vitest/coverage-v8`, `tsx`,
     `@types/node`;
   - `@lotse/protocol`: `zod@^4`; dev `quicktype`, `ajv`, `ajv-formats`;
   - `@lotse/brain`: `ai@^7`, the AI Gateway provider and `@ai-sdk/openai` (check the AI SDK 7 docs for
     current package names), `@ai-sdk/otel`, `zod@^4`, `drizzle-orm`, `postgres`, `yaml`,
     `@aws-sdk/client-s3`, `pdf-lib`, `canonicalize` (RFC 8785); dev `drizzle-kit`;
   - `@lotse/knowledge`: `zod@^4`, `yaml`, `cheerio`, `turndown`, `robots-parser`, `p-limit`;
   - `@lotse/evals`: `ai@^7`, `zod@^4`;
   - `@lotse/guide`: dev `@playwright/test`;
   - `@lotse/ui`: `react` and `react-dom` as peer and dev dependencies, at the version Next.js
     currently requires.
10. **ADR.** `docs/adr/0001-monorepo-toolchain.md`: decisions, exact versions installed, the internal
    package strategy, and how to add a package.

## Acceptance criteria

- [ ] AC1: `pnpm install --frozen-lockfile` succeeds on a clean clone.
- [ ] AC2: `pnpm -s verify` passes. Each package contributes lint, typecheck and test tasks.
- [ ] AC3: `pnpm -s format:check` passes.
- [ ] AC4: Each package has `AGENTS.md` and `README.md`, and its `exports` resolve.
  - Proven by a tiny test in `@lotse/brain`: it imports a type-only symbol from `@lotse/protocol`
    through the workspace dependency.
- [ ] AC5: No placeholder business logic; `src/index.ts` files export only what exists.

## Notes for the implementer

- Check the current AI SDK 7 package names on ai-sdk.dev before installing. The gateway provider may
  ship inside `ai` or as `@ai-sdk/gateway`.
- Keep the lockfile deterministic; do not commit `node_modules` or a pnpm store.

## Suggested commits

- `build(repo): add pnpm workspace, turborepo, biome and typescript base`
- `build(repo): add package skeletons with agent instructions`
- `build(deps): install baseline dependencies`
- `docs(adr): record monorepo toolchain decisions`
