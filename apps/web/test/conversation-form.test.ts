// @vitest-environment jsdom
import type { LotseMessage } from "@lotse/brain";
import type { Action } from "@lotse/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { createClientRuntime } from "../src/conversation/client-tools.ts";
import { ConversationForm, conversationFormId } from "../src/conversation/form.tsx";
import {
  dispatchFormAction,
  presentFormGroupApproval,
  refreshFormViewer,
} from "../src/features/form-viewer/workspace.tsx";

vi.mock("../src/features/form-viewer/workspace.tsx", () => ({
  dispatchFormAction: vi.fn(async (action: Action) => ({
    actionId: action.id,
    resolvedBy: "ui",
    success: true,
    confidence: 1,
  })),
  FormViewerWorkspace: vi.fn(() => null),
  presentFormGroupApproval: vi.fn(() => vi.fn()),
  refreshFormViewer: vi.fn(),
}));

const guide = vi.hoisted(() => ({
  execute: vi.fn(async (action: Action) => ({
    actionId: action.id,
    resolvedBy: "ui",
    success: true,
    confidence: 1,
  })),
  clear: vi.fn(),
  dispose: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@lotse/guide", () => ({ createGuide: () => guide, toCapsulePage: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function prepared(id: string): LotseMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "form.prefill",
        toolCallId: crypto.randomUUID(),
        state: "output-available",
        input: {},
        output: { formInstanceId: id },
      },
    ],
  };
}

test("FR-D5 mounts the latest successfully prepared form from authoritative tool output", () => {
  const first = crypto.randomUUID();
  const latest = crypto.randomUUID();
  expect(conversationFormId([prepared(first), prepared(latest)])).toBe(latest);
  expect(conversationFormId([prepared("untrusted-invalid-id")])).toBeUndefined();
  expect(
    conversationFormId([{ id: "user", role: "user", parts: [{ type: "text", text: first }] }]),
  ).toBeUndefined();
});

test("FR-D5 form type actions reach the mounted viewer and report its real outcome", async () => {
  const action: Action = {
    id: crypto.randomUUID(),
    kind: "type",
    sentenceIndex: 0,
    target: { kind: "form", formInstanceId: crypto.randomUUID(), fieldId: "applicant" },
    payload: {
      value: "Testperson",
      pace: 1,
      provenance: {
        source: { kind: "statement", turnId: crypto.randomUUID(), quote: "Testperson" },
      },
    },
  };
  expect(await createClientRuntime().action(action)).toMatchObject({
    actionId: action.id,
    success: true,
  });
  expect(dispatchFormAction).toHaveBeenCalledWith(action);
});

test("FR-A1 other page mutations still require the existing approval-gated client tool", async () => {
  const result = await createClientRuntime().action({
    id: crypto.randomUUID(),
    kind: "type",
    sentenceIndex: 0,
    target: { kind: "ui", elementId: "test-input" },
    payload: {
      value: "test",
      pace: 1,
      provenance: { source: { kind: "statement", quote: "test" } },
    },
  });
  expect(result).toMatchObject({ success: false, failureReason: "APPROVAL_REQUIRED" });
});

test("FR-D5 approved client fills of a PDF field use the mounted viewer instead of the page guide", async () => {
  const input = {
    target: { kind: "form" as const, formInstanceId: crypto.randomUUID(), fieldId: "applicant" },
    value: "Testperson",
    provenance: {
      source: { kind: "statement" as const, turnId: crypto.randomUUID(), quote: "Testperson" },
    },
  };
  const callId = crypto.randomUUID();
  expect(await createClientRuntime().execute(callId, "ui.fill", input)).toMatchObject({
    output: { actionId: callId, success: true },
  });
  expect(dispatchFormAction).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: callId,
      kind: "type",
      target: input.target,
      payload: expect.objectContaining({ value: input.value, provenance: input.provenance }),
    }),
  );
});

test("FR-D4 web targets stay on the page and document highlights open the viewer with a native bridge", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("webkit", { messageHandlers: { lotse: { postMessage } } });
  const openDocumentHighlight = vi.fn();
  const runtime = createClientRuntime({ openDocumentHighlight });
  const action: Action = {
    id: "mark",
    kind: "highlight",
    sentenceIndex: 0,
    target: { kind: "ui", elementId: "field" },
    payload: {},
  };
  await runtime.action(action);
  expect(guide.execute).toHaveBeenCalledWith(action);
  const documentAction: Action = {
    ...action,
    target: { kind: "text", documentId: "document", quote: "Original quote", page: 2 },
  };
  await runtime.action(documentAction);
  expect(openDocumentHighlight).toHaveBeenCalledWith(documentAction);
  expect(postMessage).not.toHaveBeenCalled();
  await runtime.action({
    ...action,
    target: { kind: "ax", role: "AXTextField", label: "Name", path: [], appBundleId: "test.app" },
  });
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "Action",
      payload: expect.objectContaining({
        target: {
          kind: "ax",
          role: "AXTextField",
          label: "Name",
          path: [],
          appBundleId: "test.app",
        },
      }),
    }),
  );
});

test("FR-D5 approved UI fills use the page guide even with a native bridge", async () => {
  const postMessage = vi.fn();
  vi.stubGlobal("webkit", { messageHandlers: { lotse: { postMessage } } });
  const target = { kind: "ui", elementId: "field" };
  const input = {
    target,
    value: "Ada",
    provenance: { source: { kind: "statement", quote: "Ada" } },
  };
  const result = await createClientRuntime().execute("fill", "ui.fill", input);
  expect(result).toMatchObject({ output: { success: true } });
  expect(guide.execute).toHaveBeenCalledWith(expect.objectContaining({ kind: "type", target }));
  expect(postMessage).not.toHaveBeenCalled();
});

test("FR-D5 pending groups enter the viewer and completed commits refresh persisted fields", async () => {
  const id = crypto.randomUUID();
  const context = {
    approvalId: "approval",
    toolCallId: "commit",
    toolName: "form.commitGroup",
    caseId: crypto.randomUUID(),
    inputHash: "0".repeat(64),
    summary: "Review",
    provenance: [],
  };
  const approvalMessage: LotseMessage = {
    id: "review",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "form.commitGroup",
        toolCallId: "commit",
        state: "approval-requested",
        input: { formInstanceId: id, fieldIds: ["name"], values: { name: "Ada" } },
        approval: { id: "approval" },
      },
    ],
  };
  const respond = vi.fn();
  const view = render(
    createElement(ConversationForm, {
      messages: [prepared(id), approvalMessage],
      language: "de",
      contexts: [context],
      onApprovalDecision: respond,
    }),
  );
  expect(presentFormGroupApproval).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ formInstanceId: id, context }),
    expect.any(Function),
  );
  const decision = { id: "approval", approved: true };
  await act(async () => {
    await vi.mocked(presentFormGroupApproval).mock.calls[0]?.[1](decision);
  });
  expect(respond).toHaveBeenCalledWith(decision);
  const committed: LotseMessage = {
    ...approvalMessage,
    parts: [
      {
        type: "dynamic-tool",
        toolName: "form.commitGroup",
        toolCallId: "commit",
        state: "output-available",
        input: {},
        output: { approvalId: "approval", values: { name: "Ada" } },
      },
    ],
  };
  view.rerender(
    createElement(ConversationForm, {
      messages: [prepared(id), committed],
      language: "de",
      contexts: [context],
      onApprovalDecision: respond,
    }),
  );
  expect(refreshFormViewer).toHaveBeenCalledWith(id);
});
