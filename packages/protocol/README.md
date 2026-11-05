# @lotse/protocol

Protocol v1 is the shared contract for the brain, workspace, guide runtime and Mac
capability provider. `src/` is the source of truth. It exports a `<Name>Schema` Zod
schema and an inferred `<Name>` TypeScript type for each PRD §9 message, plus
`Target`, shared value types and both bridge unions. The current
`PROTOCOL_VERSION` is `1.0.0`.

## TypeScript

```ts
import {
  BridgeToWorkspaceSchema,
  DATA_PARTS,
  PROTOCOL_VERSION,
  type LotseDataParts,
  type TurnRequest,
} from "@lotse/protocol";
import type { UIMessage } from "ai";

// The data-parts generic is second; metadata and tool types remain SDK-owned.
type LotseMessage = UIMessage<unknown, LotseDataParts>;

const message = BridgeToWorkspaceSchema.parse(receivedJSON);
const speechSchema = DATA_PARTS["speech-segment"];
```

Use `DATA_PARTS` keys without `data-`; the stream uses `data-speech-segment`,
`data-action`, `data-case-event`, `data-safety-notice`, `data-job-progress` and
`data-approval-context`. SDK text, tool and approval parts remain SDK-owned.
`ApprovalContext` adds display context; `ApprovalDecision` routes a native
response to `addToolApprovalResponse`.

Bridge envelopes contain exactly `{ v, type, id, payload }`. `v` must equal
`PROTOCOL_VERSION`; `type` is the PascalCase PRD message name. Each direction
accepts only its listed message types and binds `payload` to that type.
`ContextCapsule` travels in a `Transcript` or client-tool output, rather than as
an additional bridge-envelope type. `TurnRequest` has no autonomy field.

The SDK compatibility test imports AI SDK 7 from the package's own devDependency.
The protocol's product exports have no SDK runtime dependency.
The generic signature is documented in the official
[AI SDK UIMessage reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/ui-message).

## Wire conventions

The PRD leaves the following nested representations open; v1 fixes them here:

- IDs are nonempty opaque strings. App versions use SemVer; hello protocol
  versions must equal the current version. Timestamps use ISO 8601 with a UTC
  designator or explicit offset. Language tags support hyphenated language,
  script, region and variant subtags (for example `de-AT`).
- `Target.kind` is the discriminator. Point coordinates and each `BoundingBox`
  component (`x`, `y`, `width`, `height`) are normalized to 0–1, relative to the
  source image or page. Pages are one-based; screen, sentence and segment
  indices are zero-based. AX paths are arrays of string path components.
- `TargetRect.rect` uses `x`, `y`, `width`, `height` in window points; its `scale`
  is positive. Its origin may be negative. `ContextCapsule.focusedRegion` is a
  normalized bounding box. `screen.image` references the accompanying downscaled
  image file part's ID; it contains no embedded image bytes.
- `Provenance` contains an optional `factId` and a `source` with the same fields
  as `Fact.source`. `type` actions require a string value, provenance and a
  positive `pace` in milliseconds between keystrokes. Display and `clear`
  payloads contain optional string `label` and `style` fields. Values remain
  drafts until the brain records confirmation.
- Capability flags are booleans; `onDeviceContextSize` is a nonnegative integer
  (zero when unavailable). `Fact.value` is recursive JSON, including null.
  Tool inputs and case-event payloads are JSON objects. Tool-specific business
  validation belongs to the owning tool. `JobProgress.state` is a nonempty
  string because §9 prescribes no state enum. `inputHash` is lowercase hex
  SHA-256. Safety phone numbers are strings.
- Objects are strict: unknown properties fail validation. Optional fields may
  be absent but are not nullable unless their value schema includes null.
  A context capsule can be empty when no screen/page context is available.
- URLs use the shared `UriSchema` and JSON Schema's `uri` format. Spaces and
  non-ASCII characters must be percent-encoded; malformed escapes are rejected.
  Validation preserves the original string without normalization.

## Swift

Add the local package to the consuming Swift package (adjust the relative path
from the consumer's `Package.swift`):

```swift
.package(path: "../../packages/protocol/swift")
```

Add `.product(name: "LotseProtocol", package: "swift")` to the target's dependencies,
then import and decode:

```swift
import Foundation
import LotseProtocol

let envelope = try JSONDecoder().decode(BridgeToNative.self, from: data)
switch envelope {
case .action(let message):
    let action = message.payload
    // Dispatch the typed action to the capability provider.
default:
    break
}
let encoded = try JSONEncoder().encode(envelope)
```

The package uses Swift 6, macOS 14+, public structs and enums, `Codable`,
`Sendable` and `Equatable`. Public memberwise initializers expose every field;
there are no JSON convenience initializers or hidden defaults.

Generated tagged enums preserve the binding between a tag and its payload.
Decoders reject unknown keys and null in nonnullable fields. Swift scalar types
cannot express JSON Schema constraints such as numeric ranges, URL formats or
regular expressions; the Zod/JSON Schema boundary additionally validates those
constraints. The Swift tests cover invalid structures and enums and round-trip
every valid fixture, including arbitrary JSON with null.

## Generate and verify

From the repository root:

```sh
bun run --filter @lotse/protocol generate
bun run --filter @lotse/protocol typecheck
bun run --filter @lotse/protocol test
bun run --filter @lotse/protocol check:generated
swift test --package-path packages/protocol/swift
```

Generation uses Zod 4's
[`z.toJSONSchema`](https://zod.dev/json-schema) to produce Draft 2020-12 schemas
in `generated/json/<Name>.schema.json`. `protocol.schema.json` is a named
contract catalog: its `$defs` contains every message, shared type and both
bridge unions. Consumers can select `#/$defs/BridgeToNative` or
`#/$defs/BridgeToWorkspace`; the catalog itself is not a wire message.

The same script runs [quicktype](https://github.com/glideapps/quicktype) on a
temporary projection of that bundle to generate
`swift/Sources/LotseProtocol/LotseProtocol.swift`. The projection gives each
object-union branch a name, since quicktype otherwise merges those branches
into a struct with optional fields. A schema-directed generation step restores
tagged-enum wire codecs and strict object decoding. Other structs, property
types, scalar enums and JSON value codecs come from quicktype. Generated files
are never edited by hand.

`check:generated` generates into two fresh temporary directories, compares their
complete file lists and bytes, and compares them with the checked-in artifacts.
It cleans up its temporary files on success and failure.

Fixtures in `fixtures/<Name>/` describe the discharge-letter workflow using the
challenge's fictional patient. The recommendation is quoted verbatim from page
5 of `Befunde/Entlassungsbefund.pdf` under `SVBOX_DIR`, joining its printed line
break with a space. It is a documented quotation, never an assessment by the
assistant. The image reference, opaque IDs and `.example` document URL are
fixture identifiers. Original challenge files are read-only.
