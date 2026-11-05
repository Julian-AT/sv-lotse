---
id: WP-007
title: Workspace conversation client and bridge (web side)
wave: W0
lane: workspace
risk: normal
depends_on: [WP-006]
fr: [FR-C9, FR-L4, FR-A2, FR-P3, NFR-6]
owns:
  - apps/web/src/app/(workspace)/**
  - apps/web/src/conversation/**
  - apps/web/src/bridge/**
  - apps/web/e2e/conversation/**
  - packages/ui/**
may_touch:
  - apps/web/package.json
  - pnpm-lock.yaml
allow_deps: test utilities for React components if needed
live_services: [ai-gateway, openai]
gates:
  - pnpm --filter @lotse/web typecheck
  - pnpm --filter @lotse/web lint
  - pnpm --filter @lotse/web test
  - pnpm --filter @lotse/ui test
  - docker compose up -d --wait
  - pnpm --filter @lotse/brain db:migrate
  - RUN_LIVE=1 pnpm --filter @lotse/web e2e -- --grep @conversation
pr_title: "feat(workspace): add conversation client with approvals and bridge"
---

# WP-007: Workspace conversation client and bridge (web side)

## Goal

The workspace is the only conversation client (PRD §7). After this WP, in the browser:

- a signed-in user can talk to the brain;
- streamed answers appear as text and captions;
- approval requests appear as confirmation cards;
- the client tool dispatcher is in place.

The web half of the native bridge is ready for the Mac app.

## Context

- PRD §7 (one conversation client), §8 (display tools, client tools, approval transport), §9 (stream
  and bridge channels, message table), §6 (interaction loop, accessibility).
- The stream from `/api/turn` (WP-006) and the protocol types and data-part map (WP-003).
- Check the current AI SDK 7 UI docs:
  - `useChat`, `DefaultChatTransport`, `prepareSendMessagesRequest`;
  - `onToolCall`, `addToolOutput`;
  - `addToolApprovalResponse`, `sendAutomaticallyWhen`;
  - `lastAssistantMessageIsCompleteWithToolCalls`, `lastAssistantMessageIsCompleteWithApprovalResponses`.

## Deliverables

1. **Conversation module.** `src/conversation/`: `useLotseChat` wraps `useChat` with:
   - typed UI messages using `LotseDataParts`;
   - a transport that sends only the latest message plus the `TurnRequest` body;
   - `sendAutomaticallyWhen` that is true when either completion helper is true;
   - loading the case's persisted messages on open.
2. **Client tool dispatcher.**
   - `onToolCall` routes client tools to a capability registry provided by the transport adapter.
   - In a plain browser, OS capabilities return a typed `ToolOutput` error `capability_unavailable`.
     That is real behaviour, not a stub.
   - Every output is returned with `addToolOutput`.
3. **Transport adapter.** `src/conversation/adapters/`:
   - `browser`: no native capabilities; browser speech arrives in W1.
   - `mac`: delegates capabilities, speech segments, actions and approval context to the bridge.

   The `clientKind` is detected once and reported in `ClientHello`.
4. **Renderers** for each part type:
   - text;
   - `data-speech-segment`: captions in an ARIA live region;
   - `data-case-event`;
   - `data-safety-notice`: prominent, with `tel:` links for 144, 112, 1450, 142 and 147;
   - `data-job-progress`;
   - `data-action`: in the browser, forwarded to the guide runtime hook point, which is a no-op until
     WP-108. Record the action result as `capability_unavailable`.
5. **Approval card** for `approval-requested` tool parts, using `data-approval-context`:
   - shows the summary, the values with provenance and the target;
   - Approve and Reject buttons, keyboard accessible, call `addToolApprovalResponse`;
   - focus moves to the card when it appears.
6. **Bridge, web side.** `src/bridge/`:
   - detect `window.webkit?.messageHandlers?.lotse`;
   - `send(message)` returns a promise of the reply (`WKScriptMessageHandlerWithReply`);
   - expose `window.__lotse.receive(json)` for Swift;
   - validate every inbound and outbound envelope with the protocol's `BridgeToWorkspace` and
     `BridgeToNative` schemas, and drop and log (without content) anything invalid;
   - wire bridge events: `Transcript` (final) → `sendMessage` with the capsule; `ApprovalDecision` →
     `addToolApprovalResponse`; `ToolOutput` → `addToolOutput`; `SpeechControl` → UI state.
7. **Workspace page.** `src/app/(workspace)/`: the conversation view (minimal, accessible), protected by
   the session.
8. **`packages/ui`.** Shared accessible primitives used here (button, card, live region, dialog), with
   component tests including axe checks.

## Acceptance criteria

- [ ] AC1 (live, Playwright `@conversation`): sign in with the virtual authenticator, ask "Was ist die
  Rezeptgebühr?", and receive a streamed German answer. Reloading the page restores the conversation
  from the server.
- [ ] AC2: The approval card renders from protocol fixtures and calls `addToolApprovalResponse` with the
  right id on approve and on reject (component test).
- [ ] AC3: The dispatcher returns `capability_unavailable` for OS tools in the browser, and the loop
  continues (unit test with a real `useChat` store).
- [ ] AC4: The bridge rejects envelopes with an unknown type, a wrong version or an invalid payload, and
  accepts valid fixtures. This is a unit test with a simulated `window.webkit` in the test file; the
  real native end-to-end test is WP-009.
- [ ] AC5: Keyboard-only use works end to end, and axe reports no violations on the workspace page.

## Suggested commits

- `feat(workspace): add conversation hook with server-owned history`
- `feat(workspace): add client tool dispatcher and transport adapters`
- `feat(workspace): render speech, case, safety and job data parts`
- `feat(workspace): add accessible approval card`
- `feat(bridge): add validated web side of the native bridge`
- `feat(ui): add accessible primitives`
