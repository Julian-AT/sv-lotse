---
id: WP-011
title: Generated Swift validation for protocol schema constraints
wave: W0
lane: protocol
risk: high
codex_effort: high
depends_on: [WP-003]
fr: [FR-C5, NFR-13]
owns:
  - packages/protocol/scripts/**
  - packages/protocol/swift/**
  - packages/protocol/test/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - bun run --filter @lotse/protocol typecheck
  - bun run --filter @lotse/protocol test
  - bun run --filter @lotse/protocol check:generated
  - swift test --package-path packages/protocol/swift
pr_title: "feat(protocol): generate swift validation for schema constraints"
---

# WP-011: Generated Swift validation for protocol schema constraints

## Goal

PRD §9 requires every bridge message to be validated against the same schemas on both sides. The
generated Swift `Codable` types (WP-003) enforce types and discriminants but not constraints such as
`minLength`, `minimum`/`maximum`, `pattern`, `format: uri` and `additionalProperties: false`. After
this WP, the generator also emits a `validate()` for every generated type, derived from the JSON
Schema, so the Mac app rejects exactly what Zod rejects.

## Context

- PRD §9 Protocol; WP-003 generator in `packages/protocol/scripts/` (JSON Schema bundle, quicktype,
  Swift projection) and `swift/Sources/LotseProtocol/LotseProtocol.swift` (generated).
- Found by the WP-008 cross-review: an `Action` with `id: ""` and `sentenceIndex: -1` decodes in Swift
  although Zod rejects it.
- The protocol is frozen after M0; this WP adds generated validation code only. It does not change any
  schema, field or enum, so `PROTOCOL_VERSION` stays `1.0.0`.

## Deliverables

1. Generator emits Swift validation (`extension <Type> { public func validate() throws }` or a
   `ProtocolValidating` protocol) for every object type, recursing into nested types and arrays,
   covering `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `pattern` (using
   `NSRegularExpression` or Swift `Regex`, same pattern as the schema), `format: uri` (same rule as the
   TypeScript `UriSchema`), `const`, integer-ness and unknown keys (decode-time strictness for
   `additionalProperties: false`, via a strict decoding helper).
2. A `decodeValidated<T>(_ data: Data)` entry point that decodes and validates in one call.
3. Cross-language tests: every valid fixture passes Swift validation; every invalid fixture that Zod
   rejects for a constraint reason is rejected by Swift validation (a test enumerates the fixtures
   and their expected outcome; add invalid fixtures for empty id, negative index, out-of-range
   confidence, bad URI and unknown key where missing).
4. `check:generated` stays deterministic.

## Acceptance criteria

- [ ] AC1: For every fixture, Swift `decodeValidated` and Zod agree (accept or reject).
- [ ] AC2: `check:generated` passes and generation is byte-identical twice.
- [ ] AC3: No schema change; `PROTOCOL_VERSION` unchanged; generated files never hand-edited.

## Suggested commits

- `feat(protocol): generate swift validation for schema constraints`
- `test(protocol): prove swift and zod agree on every fixture`
