# ADR 0178: Repository code quality gates

- Status: accepted for WP-178
- Date: 2026-11-05
- Requirements: NFR-13; PRD §17; ADR 0013

## Context

Concurrent work packages must not introduce dead code, dependency drift, architectural coupling or
risky TypeScript patterns. Existing findings must remain visible without blocking unrelated work.
WP-179 owns their removal; WP-178 changes tooling, not application code or package APIs.

## Decision

`bun run quality` runs the following checks, with nonzero exit status for new findings:

| Tool               | Responsibility                                                                                                                                                             | Baseline                                                                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biome              | Cognitive complexity at most 15; no console outside scripts, CLIs and tests; no non-null assertions or explicit `any`; type-only imports/exports; unused imports/variables | Exact-path overrides in `biome.json`; each function and original complexity score in `scripts/quality/baseline.json`                                    |
| knip               | Unused files, exports, types, dependencies and devDependencies across Bun workspaces                                                                                       | Commented `ignoreIssues` and workspace `ignoreDependencies` entries in `knip.json`; every symbol/dependency and path in `scripts/quality/baseline.json` |
| dependency-cruiser | Architecture rules, including imports that exist only before compilation                                                                                                   | Individual edges and cycles in `.dependency-cruiser-known-violations.json`                                                                              |
| syncpack           | One dependency version across dependency, development and peer sections; `workspace:*` for internal dependencies                                                           | Two explicitly pinned Playwright ranges, with package paths in `scripts/quality/baseline.json`                                                          |

Biome also runs inside `quality` because AC1 requires that command to reject a new `console.log`.
`verify` runs lint, quality and the quality regression tests before Turborepo typechecks and tests.
The CI `verify` job runs quality and its regression tests for every change, before the existing
affected-package or full-workspace checks. None of these checks requires provider credentials.

Knip discovers package entrypoints from manifest exports and scripts. Explicit test entrypoints
include Vitest tests, Node tests and Playwright specifications; its Next.js, Playwright and Vitest
plugins discover framework configuration and application entrypoints. Public manifest exports are
intentional API entrypoints; implementation exports remain subject to unused-export detection.
Generated files, migration artifacts and Next.js build output are not project source.

Dependency-cruiser enforces:

- Db imports no other workspace package, including type-only imports.
- Knowledge imports no brain runtime code. Type-only imports remain allowed by this brief.
- Packages never import apps.
- Cross-workspace imports use package exports. Relative paths into another workspace's `src` fail,
  including paths to an otherwise exported file. Unresolvable `@lotse/*` imports fail, so a forbidden
  package subpath cannot evade the rule by failing resolution. Root scripts follow the same rule.
- Circular imports inside a workspace fail, including cycles containing type-only edges.
- Mac sources are outside the analysis scope.

`combinedDependencies` lets dependency-cruiser classify Bun workspace imports correctly. Export-map
resolution stays enabled. `tsPreCompilationDeps: "specify"` distinguishes runtime and type-only edges.
Dependency-cruiser 18 currently requires the TypeScript compiler API from a version below 7. The
repository's TypeScript 7 CLI remains unchanged. A process-local Node resolution hook uses the
existing `typescript-compiler` alias in knowledge for dependency-cruiser's compiler imports only.
The hook needs Node 22.15 or later; CI's Node 22 line and the current Node 22.23 toolchain provide it.
Missing compiler support must not silently produce an apparently successful JavaScript-only scan;
the regression probes exercise TypeScript rules against the installed tools.

Syncpack preserves knowledge's documented `npm:typescript@^6.0.3` alias. Its existing Playwright
declarations differ: `packages/guide/package.json` uses `1.64.1`, while `apps/web/package.json` uses
`^1.64.1`. Those manifests are outside WP-178's ownership, so both exact existing ranges are pinned
as a temporary baseline. Other versions of that dependency fail in either workspace. No package
manifest alignment or application dependency upgrade occurs here. Syncpack 15 calls its current
repair command `fix`; the older `fix-mismatches` command is retained for compatibility. WP-179 must
review its proposed version-range-only diff within the owning package's scope before applying it.

## Frozen findings and regression checks

The initial inventory contains 16 knip findings (five dependencies/devDependencies, eight value
exports and three type exports), 40 complex functions across 26 paths, and 15 architecture findings
(nine knowledge-to-brain runtime edges, two cycles and four relative imports into package internals).
The two Playwright manifest paths are inventoried separately. There are no existing suppressions
for the other seven stricter Biome rules and no unused-file baseline.

Path-level suppressions alone would permit additional debt in the same file. After normal knip and
Biome checks, `check-baseline.mjs` reads unsuppressed JSON reports. It compares knip findings by
path, issue kind and symbol/dependency name. Biome complexity findings consume one baseline entry
for the same path and function declaration line, with a score no higher than its original score.
Line numbers are informational, so inserting lines does not invalidate an unchanged finding.
Renaming or changing a still-complex declaration requires reviewing its baseline identity; reducing
complexity below 16 requires no exception. Malformed reports and process failures fail the gate.

`scripts/quality/quality.test.mjs` uses real installed tools in a temporary repository copy, never
the real source tree. It verifies the clean baseline, then individually injects an unused export,
a knowledge-to-brain runtime import and `console.log`. It also checks additions on baselined paths,
leaf/package/app/public-export/cycle rules and version/protocol drift. Dependency links for workspace
packages point into the copy; external dependencies are shared. No services are simulated.

## Burning down the baseline in WP-179

1. Use each inventory path, symbol, complexity score or architecture edge to select a small fix.
2. Fix the owning source and retain its behavioural tests. Do not disable a rule or widen a glob.
3. Remove the corresponding inventory entry and knip ignore entry. Remove a Biome path override
   only after its last finding is fixed. The three evals paths use evals-relative names in the root
   override because its nested Biome configuration rebases inherited patterns; the inventory always
   retains full repository paths.
4. Shrink the architecture baseline with
   `bun run quality:architecture --baseline .dependency-cruiser-known-violations.json --baseline-mode shrink-only`.
   Never regenerate it in full mode to accept a new violation.
5. Align Playwright ranges through syncpack in the owning scope, then remove both temporary pinned
   groups and their inventory rows. Retain the compiler alias until compiler-API consumers migrate.
6. Run `bun run quality`, `bun run quality:test`, `bun run verify`, `bun run format:check` and
   `actionlint`. Keep the baseline shrinking in code review; no gate automatically grows it.

## References

- [Knip configuration](https://knip.dev/reference/configuration)
- [Dependency-cruiser rules](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)
- [Dependency-cruiser options](https://github.com/sverweij/dependency-cruiser/blob/main/doc/options-reference.md)
- [Syncpack pinned version groups](https://syncpack.dev/version-groups/pinned/)
- [Biome complexity rule](https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/)
- [Node module hooks](https://nodejs.org/docs/latest-v22.x/api/module.html#moduleregisterhooksoptions)
