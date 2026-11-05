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
- `bun run --filter @lotse/protocol test` — run Zod/Ajv fixture, bridge, SDK type and Swift generator output tests under Node.js; no Swift toolchain required.
- `bun run --filter @lotse/protocol generate` — generate JSON Schema and Swift from Zod.
- `bun run --filter @lotse/protocol check:generated` — compare checked-in artifacts with two independent generations.
- `swift test --package-path packages/protocol/swift` — run Swift fixture and bridge round-trips and generated constraint probes.
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
- Generated files under `generated/`, `swift/Sources/` and
  `swift/Tests/SwiftValidationGeneratorTests/Generated/` are never edited by hand.
  Change Zod or the generator and run `generate`.
- Breaking changes use `feat(protocol)!` with a `BREAKING CHANGE:` footer.
- ESM only, strict TypeScript, Zod at boundaries; internal dependencies use `workspace:*`.
- Every PRD message exports `<Name>Schema` and its inferred `<Name>` type.
  Keep `export type { ZodType } from "zod"` for the brain's contract tests.
- The SDK owns text, tools and approval parts. Only the six custom data parts
  belong in `DATA_PARTS`; `LotseDataParts` is the SDK's second `UIMessage` generic.
  Keep `ai` as a direct devDependency for that type test only.
- All URL fields use `UriSchema`, matching the full JSON Schema `uri` format
  without normalization. Generated Swift validation uses the same URI grammar;
  shared fixtures cover opaque URIs, IP literals, escapes and invalid characters.
- Bridge envelopes bind their tag to their payload and reject unknown versions,
  tags and fields. Never add autonomy or facts to client context capsules.
- Swift generation preserves tagged object unions and strict object decoding.
  Keep recursive JSON value handling typed, equatable and sendable.
- Every generated Swift object and object union conforms to `ProtocolValidating`.
  Use `let value: Message = try decodeValidated(data)` at wire boundaries and
  `try value.validate()` for locally constructed values. Validation recurses into
  nested objects, arrays and JSON values; errors expose wire paths and constraint
  keywords, without field values. Codable alone enforces shape, not scalar bounds.
- Generate validation from JSON Schema using quicktype's wire-to-Swift field
  mapping. Preserve Zod's UTF-16 length and ECMAScript pattern semantics when
  using Foundation's ICU regex engine; do not normalize strings or URIs.
- Follow the wire conventions in README.md for fields whose nested
  representation the PRD leaves open.
- Preserve the medical boundary in PRD §4. Fixture recommendations are verbatim
  document quotes with source positions, never medical advice or interpretation.

## Evaluation suites

Every message has valid and invalid fixtures. Zod and Ajv must agree on every
fixture; Swift validated decoding round-trips every valid fixture and rejects
every invalid one. `test/fixtures/validation.json` adds test-only mutations of
existing fixtures to isolate scalar, recursive and strict-object constraints;
both Zod and Swift enumerate the same expected outcomes. TypeScript generator
tests only assert output; they never invoke a Swift toolchain. The Swift package's
isolated `SwiftValidationGeneratorTests` target compiles the synthetic fixture
and runs every constraint probe absent from the frozen protocol schema. Generate
that fixture from `scripts/swift-validation-fixture.ts` with `generate`;
`check:generated` includes it in both independent generations.
TypeScript tests assert the exact PRD message list, field names and target
variants, both bridge directions, and AI SDK 7 generic compatibility.
`check:generated` compares complete file lists and bytes, including a second
independent generation to detect nondeterminism.

## Forbidden paths

- Everything outside the brief's owned paths.
- Generated artifacts, except through `generate`.
- `KI-Challenge_UseCase.yaml` and original challenge files under `SVBOX_DIR`.
- Provider keys, local environment files and user content in logs.
