# Repository quality gates

Scope: quality regression tests and the finding inventory for WP-178. Configuration lives in
`knip.json`, `.dependency-cruiser.cjs`, `.syncpackrc.json` and `biome.json` at the repository root.

Commands (from the repository root):

- `bun run quality`: Biome, knip, dependency-cruiser and syncpack, including baseline checks.
- `bun run quality:test`: real-tool regression tests in a disposable repository copy.
- `bun run verify`: lint, quality, quality regression tests, then workspace typechecks and tests.

Invariants:

- Never inject probes into the real repository. Copies exclude environment files and Mac sources;
  workspace dependency links must resolve inside the copy. External tool installations are shared.
- `baseline.json` inventories each knip symbol/dependency and each Biome function, with its path.
  The root configurations suppress those findings; `check-baseline.mjs` reads unsuppressed tool
  output to reject new findings on the same paths and increases in existing complexity scores.
- Baselines may shrink as WP-179 removes debt. Do not add findings to make a gate pass.
- The TypeScript resolution hook affects only dependency-cruiser's compiler imports in the quality
  process. It reuses knowledge's TypeScript compiler alias; it never changes application resolution.
- Mac code, generated protocol artifacts, database migrations and original challenge data remain
  outside these tools' analysis or mutation scope.

See `docs/adr/0178-code-quality-gates.md` for rules, exceptions and baseline removal instructions.
