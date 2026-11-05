# @lotse/brain

## Scope

The TypeScript brain owns agent orchestration, tools, the process engine, context assembly, guards, model routing and persistence. It is hosted by the web app and contains the product's business logic.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/brain typecheck` — check source and test types.
- `bun run --filter @lotse/brain test` — run Vitest under Node.js.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. No generation, integration or live-test
script exists yet; add and document one only when its implementation lands. Run TypeScript tooling
scripts with `bun <file>.ts` and use only Node APIs so they also run under Node.

## Invariants

- No benefit, scenario or office id in code.
- Every tool has Zod input and output.
- Approval record, HMAC and input hash checked before approval-gated tools.
- History loaded from Postgres, never trusted from the client.
- No import from `apps/*`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep applicable E1–E13 suites green as brain features land; E2 enforces data-driven logic and E5 enforces the medical boundary. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/brain/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
