---
id: WP-010
title: Turborepo task runner with cached checks and affected CI
wave: W0
lane: repo
risk: normal
codex_effort: high
depends_on: [WP-002, WP-003]
fr: [NFR-13, NFR-16]
owns:
  - turbo.json
  - package.json
  - docs/adr/0010-turborepo.md
  - .github/workflows/ci.yml
may_touch:
  - bun.lock
  - docs/adr/0001-monorepo-toolchain.md
allow_deps: "`turbo` (latest stable 2.x) as a root devDependency"
live_services: []
gates:
  - bun install --frozen-lockfile
  - bun run verify
  - bun run verify 2>&1 | grep -q "FULL TURBO"
  - bun run format:check
  - actionlint
pr_title: "build(repo): run package tasks through turborepo"
---

# WP-010: Turborepo task runner with cached checks and affected CI

## Goal

Package tasks run through Turborepo instead of `bun run --filter '*'`, so repeated checks are cached
locally and in CI, and CI runs only the packages a change affects. Bun stays the package manager and
Node.js the runtime. The owner decided this on 2026-11-05; PRD §17 already reflects it.

## Context

- PRD §17 (Stack: "Turborepo as task runner with caching"), NFR-16 (Bun package manager, Node runtime).
- ADR 0001 (WP-001) records the current `bun run --filter` setup and the decision against
  Turborepo; this WP supersedes that part.
- Root scripts today: `typecheck`, `test`, `test:integration`, `test:live`, `generate` call
  `bun run --filter '*' <script>`; `verify` = `bun run lint && bun run typecheck && bun run test`.
- `.github/workflows/ci.yml` (WP-002): jobs `verify`, `commits`, `secrets`, `detect`, `integration`,
  `container`, `protocol-swift`, `ci-ok`.
- `.turbo/` is already in `.gitignore`.

## Scope

In scope: `turbo.json`, root scripts, CI caching and affected runs in the `verify` job, ADR 0010.

Out of scope: package source code; new package scripts beyond what a task definition needs; Vercel
Remote Cache (needs an account; local and CI file cache only).

## Deliverables

1. **`turbo` dependency.** Root devDependency, latest stable 2.x; keep `packageManager: bun@1.4.4`.
2. **`turbo.json`** with `$schema`, and tasks:
   - `typecheck`: inputs `src/**`, `test/**`, `scripts/**`, `tsconfig*.json`, `package.json`, and
     the root `tsconfig.base.json` (`$TURBO_ROOT$/tsconfig.base.json`); depends on `^typecheck` only
     if needed for correctness (packages export TS source, so probably not); no outputs.
   - `test`: inputs as typecheck plus `fixtures/**` and `generated/**`; no outputs.
   - `generate`: outputs `generated/**` and `swift/Sources/**`; `check:generated`: depends on nothing,
     cached on the same inputs.
   - `test:integration`, `test:live`, `test:db`: `cache: false`; pass through the environment
     variables they need (`DATABASE_URL`, `S3_*`, `OPENAI_API_KEY`, `ELEVENLABS_*`, `RUN_LIVE`) via
     `env` or `passThroughEnv` so they reach the process. Use strict env mode and list every variable.
   - `globalDependencies`: `tsconfig.base.json`, `biome.json`, `bun.lock`.
3. **Root scripts.** `typecheck`, `test`, `test:integration`, `test:live`, `generate` become
   `turbo run <task>`. `verify` = `bun run lint && turbo run typecheck test`. `lint` and `format*` stay
   Biome at the root (one fast invocation). `bun run --filter @lotse/<pkg> <script>` keeps working.
4. **CI.** In the `verify` job: cache `.turbo` with `actions/cache` (pinned SHA, key on OS, `bun.lock`
   and `github.sha`, restore on prefix), and on pull requests run `turbo run typecheck test
   --affected` with the base ref available (`fetch-depth: 0` or `TURBO_SCM_BASE`). On push to main run
   the full set. Keep `ci-ok` semantics unchanged. actionlint clean.
5. **ADR 0010** `docs/adr/0010-turborepo.md`: decision, task graph, cache inputs and env policy,
   affected runs in CI, why no remote cache, how to add a task. Add one line to ADR 0001's status:
   "Task running superseded by ADR 0010."

## Acceptance criteria

- [ ] AC1: `bun install --frozen-lockfile` and `bun run verify` pass.
- [ ] AC2: A second `bun run verify` with no changes reports `FULL TURBO` (gate).
- [ ] AC3: Changing a file in `packages/protocol/src` re-runs protocol and its dependents (brain) and
  replays the rest from cache. Show the `turbo run typecheck --dry=json` evidence in the report.
- [ ] AC4: `test:db` / `test:integration` receive `DATABASE_URL` and `S3_*` under strict env mode
  (prove with a dry run or a run against the compose services if `docker-compose.yml` exists).
- [ ] AC5: actionlint passes; the `verify` CI job uses the cache and `--affected` on pull requests.

## Notes for the implementer

- Check current Turborepo 2.x docs for `$TURBO_ROOT$`, `--affected`, `TURBO_SCM_BASE`, strict env
  mode and Bun support before writing the config.
- Do not cache tasks that touch Docker services or live APIs.

## Suggested commits

- `build(repo): add turborepo task graph and root scripts`
- `ci(ci): cache turborepo and run affected packages on pull requests`
- `docs(adr): record turborepo as the task runner`
