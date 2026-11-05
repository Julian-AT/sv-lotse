# ADR 0010: Turborepo task runner and affected CI

- Status: accepted; supersedes task running in ADR 0001
- Date: 2026-11-05
- Requirements: PRD §17, NFR-13, NFR-16

## Decision

Use Turborepo 2.x (initially 2.11.10) as the task runner for Bun workspaces. Bun 1.4.4 remains
the package manager and script runner; Node.js 22 or later remains the runtime for application
code and Vitest. Packages still export TypeScript source and need no build step.

Root `typecheck`, `test`, `test:integration`, `test:live` and `generate` scripts delegate to
`turbo run`. Root `verify` runs Biome lint once, followed by `turbo run typecheck test`.
Formatting also stays a single root Biome invocation. Direct commands such as
`bun run --filter @lotse/protocol test` continue to work, without Turborepo caching.

## Task graph and cache inputs

`typecheck` depends on `^typecheck`, and `test` depends on `^test`. These edges propagate upstream
source changes into dependent task hashes. They are necessary for cache correctness even though
source packages do not produce build artifacts: a protocol change must invalidate brain's checks.
Typechecks and tests have no file outputs; Turborepo caches their successful results and logs.

Typecheck inputs are `src/**`, `test/**`, `scripts/**`, `tsconfig*.json`, `package.json` and
`$TURBO_ROOT$/tsconfig.base.json`. Tests additionally hash `fixtures/**`, `generated/**`, package
Vitest configuration and the root `vitest.config.ts`. The explicit root prefix resolves paths
outside a package. `tsconfig.base.json`, `biome.json` and `bun.lock` are global dependencies, so
changes to shared compiler, formatting or dependency configuration invalidate every task.

`generate` hashes the same source inputs as typecheck and caches `generated/**` and
`swift/Sources/**`. `check:generated` shares those source inputs and also hashes the checked-in
generated files it compares, including Swift sources, so artifact drift cannot reuse a previous
success. It has no dependencies: running it must detect stale artifacts before a generator can
overwrite them. Its comparison runs in temporary directories and has no cached file outputs.

The cache directory is explicitly `.turbo/cache`, relative to each checkout. Turborepo otherwise
shares its default cache with the main Git worktree, which crosses sandbox boundaries.
This setting keeps writes inside the current checkout and matches the directory cached by CI.
The existing `.gitignore` excludes `.turbo/`.

## Environment and service policy

Use strict environment mode. `test:integration`, `test:db` and `test:live` set `cache: false`:
checks against databases, object storage and live APIs must always execute.

Uncached service and live tasks pass the whole environment through `passThroughEnv: ["*"]`;
cached tasks list inputs explicitly. This lets later features add model, service and session
variables without changing the root task configuration. Values are supplied by the caller or service
setup, never stored in task configuration. Passthrough values do not contribute to cache keys, which
is safe for these tasks because caching is disabled. Cached checks remain in strict mode and receive
no provider or storage credentials; values affecting a cached result must be listed in `env`.

## CI and cache storage

The `verify` job fetches full Git history and restores `.turbo` with the SHA-pinned `actions/cache`.
Keys include runner OS, the `bun.lock` hash and `github.sha`; restore prefixes first prefer the
same lockfile, then earlier caches for the OS. Turborepo still validates individual task hashes
after a restore. Pull requests run `turbo run typecheck test --affected` with `TURBO_SCM_BASE`
and `TURBO_SCM_HEAD` set to the event's base and head SHAs, so dependencies and their affected
consumers are selected. Pushes to main run the full set. Root lint and formatting run for both
events. Other jobs and the `ci-ok` dependency and result policy are unchanged.

Use the local file cache and GitHub Actions file cache only. Vercel Remote Cache would require
an account and credentials without adding value at this stage; do not link the repository to it
or provision a remote-cache token.

## Adding a task

1. Implement the package script, keeping Bun as the script runner and Node as the runtime.
2. Add its task definition to `turbo.json`. Hash every source, configuration, fixture and root file
   it reads. Include dependency edges when upstream changes affect the result, even for source
   packages. Shared files belong in `globalDependencies` only when they affect every task.
3. Declare all generated outputs for restoration. A check that compares committed artifacts must
   hash those artifacts and must not depend on a generator that could hide drift.
4. Set `cache: false` for service calls or side effects. Uncached service and live tasks use
   `passThroughEnv: ["*"]`; cached tasks explicitly list environment inputs in `env`.
5. Document the command in the owning package's README. Check the graph and environment with
   `bunx turbo run <task> --dry=json`, then verify cold runs, cache hits and upstream invalidation.

## Sources

- [Turborepo configuration](https://turborepo.com/docs/reference/configuration)
- [Dependent tasks and cache correctness](https://turborepo.com/docs/crafting-your-repository/configuring-tasks#dependent-tasks-that-can-be-run-in-parallel)
- [Affected runs and SCM base/head](https://turborepo.com/docs/reference/run#--affected)
- [Strict environment mode](https://turborepo.com/docs/crafting-your-repository/using-environment-variables)
- [Bun installation support](https://turborepo.com/docs/getting-started/installation)
- [GitHub Actions cache](https://github.com/actions/cache/tree/v6.1.0)
