# @lotse/ui

## Scope

The UI package owns shared React components for the web workspace. Components provide accessible presentation and interaction while the brain owns business logic and the workspace owns the conversation client.

Read the repository `AGENTS.md` and the assigned work-package brief before changing this package.

## Commands

Run from the repository root:

- `bun run --filter @lotse/ui typecheck` — check source and test types.
- `bun run --filter @lotse/ui test` — run Vitest under Node.js.
- `bunx --no-install biome check packages/ui` — scoped lint and format checks.
- `bun run --filter @lotse/ui generate:styles` — regenerate the published CSS from tokens and component rules.
- `bun run --filter @lotse/ui check:styles` — reject stale generated CSS.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

There is no build step: the package exports TypeScript source and one generated stylesheet at
`@lotse/ui/styles.css`. Generation uses Node APIs and the installed Biome formatter and runs through Bun. No integration or live-test
script is needed; this package has no service dependencies.

## Invariants

- Every publicly exported component belongs in the rendering/behaviour/axe catalogue.
- WCAG 2.2 AA checks in component tests. jsdom cannot check painted contrast or geometry;
  compute token contrast independently and preserve real-browser checks in consuming screens.
- Components live in `src/components/`; user-facing defaults live only in `src/copy/de.ts` and
  `src/copy/en.ts`, exposed by a partial `labels` prop. Domain text always comes from props.
- Native controls preserve keyboard behaviour; Field connects exactly one TextInput or Select.
- Domain components never fetch, persist, authorize or recognize voice.
- Dialog owns focus containment, opener restoration, background isolation and scroll locking.
  Its caller owns open state; set theme overrides on the document root for portals.
- `src/styles.css` is generated. Edit `src/tokens/index.ts` or `src/styles/components.css` and
  run `generate:styles`; never edit generated CSS by hand.
- 44-point targets.
- ESM only, with strict TypeScript; internal dependencies use `workspace:*`.
- Export only implemented symbols from `src/index.ts`; no placeholder business logic.
- Preserve the medical boundary in PRD §4 in user-facing text and fixtures.

## Evaluation suites

Keep the public-component axe catalogue, keyboard tests, 44px target checks, light/dark token
contrast checks and static copy checks green. No product evaluation suites run in this package.

## Forbidden paths

- Everything outside `packages/ui/` unless the assigned brief explicitly grants ownership.
- Generated files: change their source and run the generator instead.
- `KI-Challenge_UseCase.yaml` and original challenge files under `data/svbox/` are read-only.
- Provider keys and local environment files must never be written to this package.
