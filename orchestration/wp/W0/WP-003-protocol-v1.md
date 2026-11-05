---
id: WP-003
title: Protocol v1 with JSON Schema and generated Swift types
wave: W0
lane: protocol
risk: high
codex_effort: xhigh
depends_on: [WP-001]
fr: [FR-C3, FR-C5, FR-D5, FR-A2, FR-P1, NFR-13]
owns:
  - packages/protocol/**
may_touch:
  - bun.lock
allow_deps: "`ai@^7` as a devDependency for the AC5 type test only; quicktype, ajv and ajv-formats are preinstalled by WP-001"
live_services: []
gates:
  - bun run --filter @lotse/protocol typecheck
  - bun run --filter @lotse/protocol test
  - bun run --filter @lotse/protocol check:generated
  - swift test --package-path packages/protocol/swift
pr_title: "feat(protocol): add protocol v1 with json schema and swift generation"
---

# WP-003: Protocol v1 with JSON Schema and generated Swift types

## Goal

`packages/protocol` is the single contract between the brain, the web workspace, the guide runtime and
the Mac app. After this WP:

- every message of PRD §9 exists as a Zod schema with an inferred TypeScript type;
- JSON Schema is generated from the Zod schemas;
- Swift `Codable` types are generated from the JSON Schema;
- round-trip tests on both sides prove that the generated types agree.

## Context

- PRD §9, "Protocol": the message table with channel, direction and fields; the `Target` union and the
  resolution ladder.
- PRD §7: the stream channel (AI SDK UI message stream with `data-*` parts) and the bridge channel
  (Mac ⇄ workspace).
- PRD §8: display tools emit `data-action`; client tools; approval parts. The SDK's own approval parts
  are not redefined here, only `ApprovalContext` and `ApprovalDecision`.

## Deliverables

1. **Zod schemas.** In `src/`, one schema per message:
   - `BridgeHello`, `ClientHello`, `Transcript`, `TurnRequest`, `ContextCapsule`, `SpeechSegment`,
     `Action`, `ToolInvocation`, `ToolOutput`, `ApprovalContext`, `ApprovalDecision`, `ActionResult`,
     `SpeechControl`, `TargetRect`, `Fact`, `CaseEvent`, `JobProgress`, `SafetyNotice`;
   - the `Target` tagged union (`ui`, `form`, `dom`, `ax`, `text`, `point`);
   - `Action.kind` includes `type` and `clear` for live form filling. A `type` payload carries the
     value, its provenance and the pace (PRD §9, FR-D5).
   - shared types: ids, ISO timestamps, `BoundingBox` (normalized 0..1 relative to the source image or
     page), language tags.

   Field names and enums follow the PRD tables exactly. Export the schema and the inferred type for
   each message.
2. **Constants and maps.**
   - `PROTOCOL_VERSION`: a semver string, starting at `1.0.0`.
   - `DATA_PARTS`: the map of data part names (`speech-segment`, `action`, `case-event`,
     `safety-notice`, `job-progress`, `approval-context`) to their schemas.
   - A `LotseDataParts` type, usable as the data-parts generic of the AI SDK 7 `UIMessage` type. Check
     the current generic signature in the AI SDK 7 docs.
3. **Bridge unions.**
   - `BridgeToWorkspace`: Mac → workspace. `BridgeHello`, `Transcript`, `ToolOutput`,
     `ApprovalDecision`, `ActionResult`, `SpeechControl`.
   - `BridgeToNative`: workspace → Mac. `SpeechSegment`, `Action`, `TargetRect`, `ToolInvocation`,
     `ApprovalContext`, `JobProgress`, `SafetyNotice`, `SpeechControl`.
   - Each envelope is `{ v: PROTOCOL_VERSION, type: "<message>", id, payload }`, discriminated on
     `type`.
4. **JSON Schema generation.**
   - The `generate` script uses Zod 4's `z.toJSONSchema` and writes
     `generated/json/<Name>.schema.json` plus `generated/json/protocol.schema.json` (bundle with both
     bridge unions).
   - Output is deterministic: sorted keys, stable formatting.
5. **Swift generation.** The same `generate` script runs quicktype from the bundle into
   `swift/Sources/LotseProtocol/LotseProtocol.swift`:
   - structs, `Codable`, `Sendable`, `Equatable`;
   - access level `public`;
   - no convenience initializers that hide the schema.

   `swift/Package.swift` uses swift-tools-version 6.0, platform macOS 14, products `LotseProtocol`, and
   a test target.
6. **Fixtures.** For each message, in `fixtures/<Name>/`: at least one valid and one invalid JSON
   example, with realistic content. Use the scenario 3 discharge-letter context; quotes are verbatim
   recommendations; no medical advice.
7. **TypeScript tests.**
   - Every valid fixture parses and every invalid one fails.
   - Ajv validation of the generated JSON Schema agrees with Zod on every fixture.
   - Bridge envelopes reject an unknown `type` and a wrong `v`.
8. **`check:generated` script.** Regenerates into a temporary directory and fails if the result
   differs from the committed `generated/` and `swift/Sources/` files.
9. **Swift tests.** Decode every valid fixture, re-encode it, and compare semantically with the source
   JSON (normalize through `JSONSerialization`). Invalid fixtures fail to decode where the type system
   can express the constraint.
10. **Package docs.** `AGENTS.md` invariants:
    - any schema change bumps `PROTOCOL_VERSION`, regenerates and updates fixtures in the same change;
    - generated files are never edited by hand;
    - breaking changes use `feat(protocol)!` with a `BREAKING CHANGE:` footer.

    `README.md`: consumption from TypeScript and Swift (local Swift package path).

## Acceptance criteria

- [ ] AC1: Every PRD §9 message and `Target` variant exists with exactly the PRD's fields (a test
  compares the exported message names to the list in this brief).
- [ ] AC2: Zod and the JSON Schema agree on all fixtures (Ajv test).
- [ ] AC3: Swift round-trip passes for all valid fixtures.
- [ ] AC4: `check:generated` passes; generation is deterministic (running it twice changes nothing).
- [ ] AC5: `LotseDataParts` type-checks as the data-parts generic of an AI SDK 7 `UIMessage` (type
  test).

## Notes for the implementer

- `packages/brain/test/workspace.test.ts` (owned by WP-001, not by you) imports the type
  `ZodType` from `@lotse/protocol`. Keep `export type { ZodType } from "zod";` in
  `src/index.ts` alongside the protocol exports, or the brain test breaks.

## Suggested commits

- `feat(protocol): add zod schemas for stream and bridge messages`
- `build(protocol): generate json schema and swift types`
- `test(protocol): add fixtures and round-trip tests`
