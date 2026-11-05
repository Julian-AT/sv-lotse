# @lotse/protocol

## Scope

The protocol package owns shared Zod contracts, generated JSON Schema and Swift
types, and contract fixtures. It is the only contract between the brain,
workspace, guide runtime and Mac capability provider.

Read the repository `AGENTS.md`, PRD §§4, 7–9 and the assigned brief before
changing this package. Everything outside `packages/protocol/` is read-only
unless the brief explicitly grants ownership.

## Commands

Run from the repository root:

- `bun run --filter @lotse/protocol typecheck` — check source, generators and test types.
- `bun run --filter @lotse/protocol test` — run Zod/Ajv fixture, bridge and SDK type tests under Node.js.
- `bun run --filter @lotse/protocol generate` — generate JSON Schema and Swift from Zod.
- `bun run --filter @lotse/protocol check:generated` — compare checked-in artifacts with two independent generations.
- `swift test --package-path packages/protocol/swift` — run Swift fixture and bridge round-trips.
- `bun run lint` — lint with Biome.
- `bun run format:check` — check formatting.

Run TypeScript tooling with `bun <file>.ts`, using Node APIs. No live service,
Docker or provider credentials are required by this package. If nested SwiftPM
sandboxing is unavailable, `swift test --disable-sandbox --package-path
packages/protocol/swift` runs the same tests inside the existing outer sandbox;
report the exact required gate separately.

## Invariants

- Any schema change bumps `PROTOCOL_VERSION`, regenerates JSON Schema and Swift,
  and updates fixtures in the same change.
- Generated files under `generated/` and `swift/Sources/` are never edited by hand.
  Change Zod or the generator and run `generate`.
- Breaking changes use `feat(protocol)!` with a `BREAKING CHANGE:` footer.
- ESM only, strict TypeScript, Zod at boundaries; internal dependencies use `workspace:*`.
- Every PRD message exports `<Name>Schema` and its inferred `<Name>` type.
  Keep `export type { ZodType } from "zod"` for the brain's contract tests.
- The SDK owns text, tools and approval parts. Only the six custom data parts
  belong in `DATA_PARTS`; `LotseDataParts` is the SDK's second `UIMessage` generic.
  Keep `ai` as a direct devDependency for that type test only.
- All URL fields use `UriSchema`, matching the full JSON Schema `uri` format
  without normalization. `invalid-uri-*` fixtures test scalar constraints at
  the Zod/Ajv boundary; Swift preserves these strings and tests their round-trip.
- Bridge envelopes bind their tag to their payload and reject unknown versions,
  tags and fields. Never add autonomy or facts to client context capsules.
- Swift generation preserves tagged object unions and strict object decoding.
  Keep recursive JSON value handling typed, equatable and sendable.
- Follow the wire conventions in README.md for fields whose nested
  representation the PRD leaves open.
- Preserve the medical boundary in PRD §4. Fixture recommendations are verbatim
  document quotes with source positions, never medical advice or interpretation.

## Evaluation suites

Every message has valid and invalid fixtures. Zod and Ajv must agree on every
fixture; Swift round-trips every valid fixture and rejects structurally invalid
ones. TypeScript tests assert the exact PRD message list, field names and target
variants, both bridge directions, and AI SDK 7 generic compatibility.
`check:generated` compares complete file lists and bytes, including a second
independent generation to detect nondeterminism.

## Forbidden paths

- Everything outside the brief's owned paths.
- Generated artifacts, except through `generate`.
- `KI-Challenge_UseCase.yaml` and original challenge files under `SVBOX_DIR`.
- Provider keys, local environment files and user content in logs.
