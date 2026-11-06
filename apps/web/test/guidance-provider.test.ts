// @vitest-environment jsdom
import type { Action } from "@lotse/protocol";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { dispatchFormAction } from "../src/features/form-viewer/workspace.tsx";
import { DocumentViewer } from "../src/features/viewer/document-viewer.tsx";
import { GuidanceProvider, useGuidance } from "../src/speech/provider.tsx";

vi.mock("../src/features/viewer/document-viewer.tsx", () => ({
  DocumentViewer: vi.fn(() => null),
}));
vi.mock("../src/features/form-viewer/workspace.tsx", () => ({
  dispatchFormAction: vi.fn(async (action: Action) => ({
    actionId: action.id,
    resolvedBy: "ui",
    success: true,
    confidence: 1,
  })),
}));
const execute = vi.hoisted(() =>
  vi.fn(async (action: Action) => ({
    actionId: action.id,
    success: true,
    resolvedBy: "ui",
    confidence: 1,
  })),
);
vi.mock("@lotse/guide", () => ({
  createGuide: () => ({ execute, clear: vi.fn(), dispose: vi.fn() }),
}));
class Utterance {
  onstart: (() => void) | undefined;
  lang = "";
}
let guidance: ReturnType<typeof useGuidance> | undefined;
function Probe(): null {
  guidance = useGuidance();
  return null;
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test("FR-D4 FR-D5 guidance playback opens source documents and executes web form/page targets with a Mac bridge", async () => {
  const queued: Utterance[] = [];
  const postMessage = vi.fn();
  vi.stubGlobal("webkit", { messageHandlers: { lotse: { postMessage } } });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    speak: (utterance: Utterance) => queued.push(utterance),
    cancel: vi.fn(),
  });
  const props = { language: "de" as const, children: createElement(Probe) };
  render(createElement(GuidanceProvider, props));
  const context = guidance;
  if (!context) throw new Error("Missing provider");
  context.setCaseId("case");
  const form: Action = {
    id: "fill",
    kind: "type",
    sentenceIndex: 0,
    target: { kind: "form", formInstanceId: crypto.randomUUID(), fieldId: "name" },
    payload: {
      value: "Ada",
      pace: 100,
      provenance: { source: { kind: "statement", quote: "Ada" } },
    },
  };
  context.ingest({ type: "data-action", data: form });
  context.ingest({
    type: "data-action",
    data: {
      id: "page",
      kind: "highlight",
      sentenceIndex: 0,
      target: { kind: "ui", elementId: "field" },
      payload: {},
    },
  });
  context.ingest({
    type: "data-action",
    data: {
      id: "source",
      kind: "highlight",
      sentenceIndex: 0,
      target: { kind: "text", documentId: "document", page: 2, quote: "Exact source quote" },
      payload: {},
    },
  });
  context.ingest({
    type: "data-speech-segment",
    data: {
      turnId: "turn",
      index: 0,
      text: "Source",
      language: "de",
      citations: [],
      actionIds: ["fill", "page", "source"],
    },
  });
  expect(dispatchFormAction).not.toHaveBeenCalled();
  await act(async () => queued[0]?.onstart?.());
  expect(dispatchFormAction).toHaveBeenCalledWith(form);
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: "page" }));
  expect(DocumentViewer).toHaveBeenCalledWith(
    expect.objectContaining({
      selection: {
        actionId: "source",
        caseId: "case",
        documentId: "document",
        page: 2,
        quote: "Exact source quote",
      },
    }),
    undefined,
  );
  expect(postMessage).not.toHaveBeenCalled();
  expect(context.takeActionResults()).toEqual(
    expect.arrayContaining([expect.objectContaining({ actionId: "fill", success: true })]),
  );
});
