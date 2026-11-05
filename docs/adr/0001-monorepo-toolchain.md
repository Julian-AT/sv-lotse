# ADR 0001: Monorepo toolchain and TypeScript source packages

- Status: accepted for WP-001
- Date: 2026-11-05
- Requirements: PRD §17, NFR-13, NFR-16

## Context

Later work packages need existing package boundaries, a shared strict toolchain and a deterministic
dependency baseline. The web and Mac apps belong to later work packages. This foundation introduces
no product logic or protocol schemas.

## Decisions

### Package manager and runtime

Use Bun 1.4.4 for dependency installation and script orchestration, preserving the root
`packageManager`, engines, Husky `prepare` script and commitlint dependencies. Workspaces match
`apps/*` and `packages/*`. Internal dependencies use `workspace:*`; Bun links them and runs filtered
scripts in dependency order. No Turborepo or separate task scheduler is needed.

Node.js 22 or later runs Vitest and application code; Bun does not replace their runtime. `.nvmrc`
selects the current Node 22 release. Verification used Node 22.23.3; Vitest 5.1 requires at least
22.12 on the Node 22 line. Run package scripts with `bun run`, never `bun test`, `bun build` or
`--bun`. TypeScript tooling scripts use `bun <file>.ts` with Node APIs only.

Commit the Bun-generated `bun.lock` and use `bun install --frozen-lockfile` for reproducible installs.
No `bunfig.toml` is needed: default install and runtime settings suffice. In worker worktrees set
`HUSKY=0` when installing to preserve the existing hook configuration without writing Git metadata;
normal developer installs retain `prepare: husky`.

### TypeScript source packages

All six private ESM packages export `./src/index.ts` through their package `exports` map and have
no build step. Next.js will consume them through `transpilePackages` in WP-005. Bun and Vitest
consume TypeScript directly. Entrypoints export only existing symbols: five are empty ESM modules;
protocol re-exports the existing Zod `ZodType` type for the workspace import check. This does not
introduce a placeholder schema or claim a protocol version.

The shared TypeScript configuration targets ES2023 with `module: ESNext` and
`moduleResolution: Bundler`. Strict mode, unchecked index access, exact optional properties,
verbatim module syntax and isolated modules apply throughout. TypeScript extensions are permitted
for source imports; typechecks never emit files. `skipLibCheck` avoids rechecking external declaration
files; authored source and tests are checked. Browser DOM libraries and React JSX are scoped to UI.

Use package exports and workspace links for resolution, without root path aliases or project
references. Aliases could conceal broken exports; references would add a composite build lifecycle
that source-only packages do not need. Every package extends the base and checks its own source and
tests with `tsc --noEmit`, resolving source dependencies transitively. The root configuration checks
the root Vitest config and supplies editor context; it can be checked with `bun run tsc --noEmit`.

### Checks and formatting

Root `verify` runs lint, then all package typechecks, then all package tests. Each package runs
`vitest run --passWithNoTests`, allowing genuinely empty skeletons without fabricated product tests.
The brain's AC4 test imports `ZodType` from `@lotse/protocol` using its workspace dependency. Its
typecheck proves the type resolves through the package export, while Vitest executes the test.
The root Vitest config also defines `projects: ["packages/*"]` for a single multi-project run.

Biome uses its recommended rule preset, two-space indentation, a 100-column line width and double
quotes. Root tooling configuration, apps, packages, scripts and ADRs are included. Existing
orchestration assets, challenge inputs and other pre-existing documents remain outside this scope.
Generated directories, Drizzle output, `.next`, `dist`, `coverage` and original `data/svbox` data are
force-ignored; Git ignore rules also apply. This keeps `format` from rewriting read-only inputs.

Root `test:integration`, `test:live` and `generate` forward to workspaces that implement those
scripts. Skeletons do not claim service-backed tests or generators before they exist.

### Dependency selection

Install the latest stable majors allowed by the brief, with AI SDK 7 and Zod 4 explicitly selected.
The current AI SDK documentation confirms the `ai`, `@ai-sdk/openai` and `@ai-sdk/otel` package
names. React and React DOM 19.3.1 are both peer and development dependencies of UI; they satisfy
Next.js 16.4.5's published peer ranges and its installation guidance to use current React releases.
Next.js itself is not installed until WP-005.

Playwright is pinned to 1.64.1, the latest complete stable release in major 1 at installation time.
The registry advertises `@playwright/test@1.65.0` and `playwright@1.65.0`, but the latter requires
the unpublished `playwright-core@1.65.0`; Bun cannot resolve that dependency. Upgrade the three
matching packages together once the stable release is complete.

Exact installed direct dependency versions (the lockfile records the full transitive graph):

Locations below name package directories; `dev` and `peer` identify dependency roles. The brain also
depends on protocol through `workspace:*`.

| Dependency                        | Exact version | Location                          |
| --------------------------------- | ------------- | --------------------------------- |
| `typescript`                      | 7.0.2         | Root (dev)                        |
| `@biomejs/biome`                  | 2.6.5         | Root (dev)                        |
| `vitest`                          | 5.1.0         | Root (dev)                        |
| `@vitest/coverage-v8`             | 5.1.0         | Root (dev)                        |
| `@types/node`                     | 26.6.6        | Root (dev)                        |
| `@commitlint/cli`                 | 21.2.4        | Root (existing dev)               |
| `@commitlint/config-conventional` | 21.2.4        | Root (existing dev)               |
| `husky`                           | 9.1.7         | Root (existing dev)               |
| `zod`                             | 4.6.7         | protocol, brain, knowledge, evals |
| `quicktype`                       | 26.0.0        | protocol (dev)                    |
| `ajv`                             | 8.20.0        | protocol (dev)                    |
| `ajv-formats`                     | 3.0.1         | protocol (dev)                    |
| `ai`                              | 7.0.163       | brain, evals                      |
| `@ai-sdk/openai`                  | 4.0.109       | brain                             |
| `@ai-sdk/otel`                    | 1.0.163       | brain                             |
| `drizzle-orm`                     | 0.45.4        | brain                             |
| `postgres`                        | 4.0.0         | brain                             |
| `yaml`                            | 2.9.1         | brain, knowledge                  |
| `@aws-sdk/client-s3`              | 3.1162.0      | brain                             |
| `pdf-lib`                         | 1.17.1        | brain                             |
| `canonicalize`                    | 5.1.0         | brain                             |
| `drizzle-kit`                     | 0.31.11       | brain (dev)                       |
| `cheerio`                         | 1.2.0         | knowledge                         |
| `turndown`                        | 7.2.5         | knowledge                         |
| `robots-parser`                   | 3.0.1         | knowledge                         |
| `p-limit`                         | 7.3.3         | knowledge                         |
| `@playwright/test`                | 1.64.1        | guide (dev)                       |
| `react`                           | 19.3.1        | ui (dev and peer)                 |
| `react-dom`                       | 19.3.1        | ui (dev and peer)                 |

## Adding a package

1. Create `packages/<name>/package.json` with a unique `@lotse/<name>` name, `private: true`,
   `type: module` and `exports: { ".": "./src/index.ts" }`.
2. Add `src/index.ts`, exporting only implemented symbols, and a `tsconfig.json` extending
   `../../tsconfig.base.json` that includes the package's source and tests.
3. Add `typecheck: tsc --noEmit` and `test: vitest run --passWithNoTests`. The existing root filters
   and Vitest project glob discover the package automatically.
4. Write a scope README and an `AGENTS.md` covering commands, PRD invariants, forbidden paths and
   applicable evaluation suites. Document real generation or service-test commands as they land.
5. Install dependencies with `bun add` from that package directory, using `workspace:*` for internal
   packages and `--dev` or `--peer` where appropriate. Let Bun regenerate the lockfile.
6. Run `bun install --frozen-lockfile`, `bun run verify` and `bun run format:check`.

## Sources

- [Bun workspaces](https://bun.sh/docs/pm/workspaces) and
  [filtered script execution](https://bun.sh/docs/pm/filter)
- [TypeScript bundler module resolution](https://www.typescriptlang.org/tsconfig/moduleResolution.html)
- [Vitest test projects](https://vitest.dev/guide/projects)
- [Biome configuration](https://biomejs.dev/reference/configuration/)
- [AI SDK 7](https://ai-sdk.dev/docs/introduction),
  [OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai) and
  [OpenTelemetry integration](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation) and
  [published Next.js package metadata](https://registry.npmjs.org/next/16.4.5)
- [Playwright test metadata](https://registry.npmjs.org/@playwright/test/1.65.0) and
  [Playwright core releases](https://registry.npmjs.org/playwright-core)
