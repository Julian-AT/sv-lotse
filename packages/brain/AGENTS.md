# @lotse/brain

## Scope

The TypeScript brain owns agent orchestration, tools, the process engine, context assembly, guards
and model routing. It is hosted by the web app and contains the product's business logic. Shared
persistence belongs to `@lotse/db`.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/brain typecheck` — check source and test types.
- `bun run --filter @lotse/brain test` — run Vitest under Node.js, excluding `test/**/*.db.test.ts`.
- `bun run --filter @lotse/brain test -- test/forms/detect` — real SV-Box AcroForm/flattened tests and E13 fixture harness; no provider calls.
- `RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/forms/detect` — rasterize an original SV-Box page and detect fields through real OpenAI. Requires `OPENAI_API_KEY`; `FORM_VISION_MODEL` defaults to `gpt-4.1-mini` and can be overridden. Loads root `.env.local` without overwriting exported values.
- `bun run --filter @lotse/brain test:db` — deprecated delegate to `@lotse/db test:db`.
- `bun run --filter @lotse/brain test:integration` — deprecated delegate to `@lotse/db test:integration`.
- `bun run --filter @lotse/brain db:generate` — deprecated delegate to `@lotse/db db:generate`.
- `bun run --filter @lotse/brain db:migrate` — deprecated delegate to `@lotse/db db:migrate`.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source. Run TypeScript tooling scripts with
`bun <file>.ts` and use only Node APIs so they also run under Node. `test` runs without services.
The deprecated database scripts and the exports `./db`, `./db/schema`, `./db/approvals`,
`./db/migrations` and `./storage/s3` remain for in-flight work packages; WP-014 removes them.
New code imports `@lotse/db` directly. Persistence commands, service setup and invariants are in
[`packages/db/AGENTS.md`](../db/AGENTS.md). Until WP-014 migrates knowledge off the compatibility
exports, brain must not add a dependency on knowledge; afterward brain may depend on knowledge,
and knowledge must never depend on brain. Db remains a leaf workspace package.

## Invariants

- No benefit, scenario or office id in code.
- Every tool has Zod input and output.
- Approval record, HMAC and input hash checked before approval-gated tools.
- History loaded from Postgres, never trusted from the client.
- No import from `apps/*`.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.
- `@lotse/brain/forms/detect` returns `auto` drafts only. Boxes use the displayed PDF CropBox in
  points, top-left origin, one-based pages, including rotation. `mode: "acroform"` reads exactly
  one field per widget; the default `auto` mode also detects missing fields from page content.
- Form detection owner headers are data in `src/forms/detect/owner-patterns.json`. Detection joins
  nearby fragments and up to three adjacent, left-aligned lines with normalized whitespace.
  Sections persist across pages until the next header; a heading within 80 points of the top also owns
  running-header identifiers. Doctor/hospital fields are never implicitly reassigned to applicants.
  Vision ownership is reconciled onto overlapping widgets before duplicate suppression; recompute
  the signature flag using the preserved widget type. Comb grouping starts at the leftmost cell
  in spatial order and emits each cell once, independently of PDF drawing order.
- Vision configuration is validated only when needed. Scanned rendering uses PDF.js's optional
  Node canvas, or a caller-supplied real `renderPage` implementation; absence fails explicitly.
  Keep provider calls behind `detectVisionFields`; never log page content or provider errors.
- Detection fixtures read `SVBOX_DIR` relative to the repository root (absolute paths also work).
  Original PDFs are read-only; flattening and rasterization happen in memory. Live tests are
  excluded from the offline `test` script and run only through `test:live`.
- Audit records contain only opaque identifiers and action names, never user content. They have no
  cascading foreign keys; the database rejects UPDATE, DELETE and TRUNCATE.
- Only `vector` and `pgcrypto` extensions are installed. Embeddings have 1536 dimensions; changing
  this requires a migration and re-embedding. Austrian synonyms expand at query time.

## Evaluation suites

Keep applicable E1–E13 suites green as brain features land; E2 enforces data-driven logic and E5 enforces the medical boundary. WP-001 adds no product evaluation suites.

## Forbidden paths

- Everything outside `packages/brain/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
