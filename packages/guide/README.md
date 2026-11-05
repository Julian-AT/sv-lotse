# @lotse/guide

Browser-only page runtime for snapshots, DOM/text targeting, closed-shadow overlays and visible
typing.

```ts
import { createGuide, toCapsulePage } from "@lotse/guide";

const guide = createGuide({
  allowlist: [location.origin], // Exact HTTP(S) origins; no wildcard or URL paths.
  ghostPreview: true, // L1: display values beside fields without focus or keystrokes.
});
const page = toCapsulePage(guide.snapshot());
// Forward only approved protocol Actions from the trusted caller.
// await guide.execute(action);
guide.dispose();
```

`snapshot()` returns `{ url, handles }`. Each handle includes `handle`, `role`, `label`, `value`,
`visible`, `credential` and a normalized `bbox` clipped to the viewport and ancestor overflow regions.
The capsule projection keeps visible non-credential elements, renames `handle` to `id`, drops the
internal flags and validates the protocol page shape. Credential values are always empty internally.
Password inputs and fields with credential autocomplete tokens (username, current/new password,
one-time-code or webauthn, including token lists) are excluded from capsules and denied for actions.
Handles derive from structure and semantic identity, distinguish duplicate controls, and retain their
identity when unrelated nodes are inserted during the runtime's lifetime. Replacement nodes can reuse
a handle only through a unique structural identity anchored by an ID or control name. Ambiguous and
unanchored replacements receive new handles; old actions fail with `target-not-found`.
Handle lookup also compares the live semantic identity before every write. Repurposing a field
during pointing, between characters or inside a page event handler stops entry, even without a
new snapshot.

Accessible names use `aria-labelledby` (including referenced labels), then `aria-label`, associated
explicit/wrapping labels, content for supporting roles and native button values, then alt/title and
finally placeholder. Names from content include descendant alternatives such as image alt text;
ordinary ARIA containers do not inherit descendant text as their names. Whitespace is normalized;
blank ARIA labels and referenced names do not replace descendant content.
This is a documented subset of accessible-name computation,
not a replacement for the browser accessibility tree. Text quotes are case-sensitive after whitespace
normalization. Ambiguity counts visible matching ranges, excluding fully clipped occurrences.
Adjacent inline-level boxes do not introduce whitespace, including nested flex/grid items whose
computed display is blockified. Block-flow boundaries and explicit line breaks separate words.
Ambiguous visible quotes fail instead of guessing.

`execute()` validates protocol actions and returns an `ActionResult` with `resolvedBy: "dom"`.
Unsupported targets/actions, stale URLs, hidden/missing targets, denied controls and disallowed origins
fail with an explicit reason. Built-in JSON deny rules are Zod-validated; `denyList` adds caller rules
without removing the defaults. The runtime never dispatches click or submission events and has no
network calls. It does not validate approvals: the trusted caller must authorize values before entry.
Denied native and actionable ARIA ancestors protect nested targets; ordinary form, group and region
ancestors do not deny an unrelated field because they contain a denied button.

Typing supports text/search/email/url/tel inputs and textareas, uses the native prototype value setter
and emits keyboard, cancellable `beforeinput`, `input` and blur/change events. Pace is milliseconds
between Unicode code points. After awaiting typing, execution yields to the next task so the complete
input/blur/change microtask checkpoint runs, including nested microtasks. It then rechecks cancellation,
target identity, denial and the final value. A value differing from the approved value returns `value-changed`.
Cancellation or changing fields stops further writes; partial values are
not rolled back because portals may persist every input event. Overlapping executions return `busy`.
`clear()` cancels active work and removes the overlay host; a protocol `clear` empties the target field.
`dispose()` also makes the runtime unusable. No raw CSS payload or HTML is injected into annotations.

The cursor, highlights, annotations, captions and ghost preview live in one closed shadow root.
Its host carries essential inline `!important` styles and uses a manual top-layer popover to escape
page clipping and transforms. Host tag/attribute selectors, `body *`, `body > *`, and universal
opacity/color rules cannot hide or restyle the overlay. Page scripts cannot query its content.
The runtime adds no rules to page stylesheets and never restyles the document root; a page that
hides its own root is outside this isolation contract.

From the repository root:

```sh
bun run --filter @lotse/guide typecheck
bun run --filter @lotse/guide test
bunx playwright install chromium
bun run --filter @lotse/guide e2e
```

Playwright serves fixtures locally on port 4178. Its runner uses only Node APIs and creates its
required default configuration export in a temporary file, retaining named exports in repository
source. The worker sandbox currently denies Chromium's Mach bootstrap registration; the orchestrator
can run the gate on the host or use a matching Playwright server in Docker. Follow the
[Playwright remote connection instructions](https://playwright.dev/docs/docker#remote-connection)
and forward loopback access to the fixture server:

```sh
PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:4179/ \
PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>' \
bun run --filter @lotse/guide e2e
```

The suite validates all four original snapshots, 2 px DOM/text overlay alignment, paced plain and
controlled typing, all denied fixture controls, hostile CSS isolation and origin refusal. Hardening
fixtures cover changed identities, deferred validation, ARIA containers, image alternatives,
English confirmation labels, clipped quote occurrences and inline-level text boundaries. The external Chromium
debugger measures closed-shadow geometry; page scripts retain no access to the overlay nodes.
