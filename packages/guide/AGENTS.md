# @lotse/guide

## Scope

The guide package owns the page runtime for snapshots, pointing, highlighting and fill previews. It applies deny-list data while operating inside guided pages.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/guide typecheck` — check source and test types.
- `bun run --filter @lotse/guide test` — run Vitest under Node.js.
- `bunx playwright install chromium` — install the browser used by E8 fixtures.
- `bun run --filter @lotse/guide e2e` — run Playwright against local HTML fixtures in Chromium.
- `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4179/ PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' bun run --filter @lotse/guide e2e` — use a matching external Playwright server when local browser launch is unavailable.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports browser TypeScript source. The local test server uses
Node's type stripping and serves real source modules with an import map. The E8 runner materializes
Playwright's mutable configuration from named exports in `playwright.config.ts` into a temporary
ESM file and removes it afterward. No live provider or DOM emulator is required.

## Invariants

- Deny list is data, not code.
- No network calls.
- Overlay content and its styles live only inside one closed shadow root. Essential host styles
  are inline with `!important`; never inject styles into the page's stylesheets or restyle its root.
- Visibility intersects viewport and ancestor overflow clips; resolution and typing use that same check.
- `toCapsulePage` removes invisible and credential handles and projects to the frozen protocol schema.
  Credential values are always empty internally; validated autocomplete tokens supplement password detection.
- Never recycle issued handles for ambiguous or unanchored replacement nodes. Rebinding requires a
  unique structural identity anchored by an ID or control name; surviving nodes retain their handles.
- Every action checks its origin; typing rechecks the target and deny list between characters.
- Built-in deny rules cannot be removed by caller configuration. Never dispatch click or submission.
- `clear()` removes overlays and cancels active typing; the protocol clear action empties a field.
- Pointing rechecks cancellation before rendering labels; typing verifies the requested value after
  blur/change handlers have run.
- AC5 protects against descendant, tag and attribute selectors, including universal opacity/color
  rules. Hiding the document root itself is outside the isolation contract.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Unit tests cover capsule projection, deny-list validation and static safety. Chromium fixtures cover
all four snapshots, DOM/text geometry within 2 px, paced plain and controlled typing, every denied
fixture control, closed-shadow isolation under hostile CSS, origin refusal and L1 ghost previews.
Geometry inspection uses the external Chromium debugger; no fixture script receives the closed root.

## Forbidden paths

- Everything outside `packages/guide/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
