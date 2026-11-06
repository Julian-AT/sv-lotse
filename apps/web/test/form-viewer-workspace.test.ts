// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { CaseConversation } from "../src/conversation/case-conversation.tsx";
import { FormViewerWorkspace } from "../src/features/form-viewer/workspace.tsx";

const caseId = "358f7746-7510-4ecf-95e5-b7a23af607be";

vi.mock("../src/conversation/case-conversation.tsx", () => ({
  CaseConversation: vi.fn(() => null),
}));
vi.mock("../src/features/form-viewer/form-viewer.tsx", () => ({
  FormViewer: ({
    onInstanceLoaded,
  }: {
    onInstanceLoaded?: (instance: { caseId: string }) => void;
  }) => {
    useEffect(() => onInstanceLoaded?.({ caseId }), [onInstanceLoaded]);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("a standalone form opens its owning case conversation after loading", () => {
  render(createElement(FormViewerWorkspace, { formInstanceId: caseId, language: "de" }));

  expect(CaseConversation).toHaveBeenCalledWith(
    expect.objectContaining({ caseId, language: "de" }),
    undefined,
  );
});

test("an embedded form keeps its existing approval responder without opening another conversation", () => {
  render(
    createElement(FormViewerWorkspace, {
      formInstanceId: caseId,
      language: "de",
      onApprovalDecision: vi.fn(async () => {}),
    }),
  );

  expect(CaseConversation).not.toHaveBeenCalled();
});

test("a form inside the chat does not reload the case conversation and interrupt the turn", () => {
  render(
    createElement(FormViewerWorkspace, { formInstanceId: caseId, language: "de", embedded: true }),
  );

  expect(CaseConversation).not.toHaveBeenCalled();
});
