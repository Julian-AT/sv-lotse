import { afterEach, expect, it, vi } from "vitest";
import { GuidanceRuntime } from "../src/speech/runtime.ts";

class TestUtterance {
  onstart: (() => void) | undefined;
  onend: (() => void) | undefined;
  onerror: (() => void) | undefined;
  lang = "";
  constructor(readonly text: string) {}
}

const action = {
  type: "data-action",
  data: {
    id: "mark",
    kind: "highlight",
    target: { kind: "text", documentId: "doc", page: 1, quote: "A quote." },
    payload: {},
    sentenceIndex: 0,
  },
};

const segment = {
  type: "data-speech-segment",
  data: {
    turnId: "turn",
    index: 0,
    text: "A quote.",
    language: "en",
    citations: [],
    actionIds: ["mark"],
  },
};
afterEach(() => vi.unstubAllGlobals());

it("FR-D4 browser actions wait for actual speech start and stay after audio ends or stops", () => {
  const queued: TestUtterance[] = [];
  vi.stubGlobal("SpeechSynthesisUtterance", TestUtterance);
  vi.stubGlobal("window", {
    speechSynthesis: {
      speak: (utterance: TestUtterance) => queued.push(utterance),
      cancel: vi.fn(),
    },
  });
  const execute = vi.fn();
  const runtime = new GuidanceRuntime(execute);
  runtime.ingest(action);
  runtime.ingest(segment);
  expect(execute).not.toHaveBeenCalled();
  queued[0]?.onstart?.();
  expect(execute).toHaveBeenCalledTimes(1);
  queued[0]?.onend?.();
  runtime.stop();
  expect(execute).toHaveBeenCalledTimes(1);
});

it("FR-D4 stopped utterance callbacks cannot apply a stale highlight", () => {
  const queued: TestUtterance[] = [];
  vi.stubGlobal("SpeechSynthesisUtterance", TestUtterance);
  vi.stubGlobal("window", {
    speechSynthesis: {
      speak: (utterance: TestUtterance) => queued.push(utterance),
      cancel: vi.fn(),
    },
  });
  const execute = vi.fn();
  const runtime = new GuidanceRuntime(execute);
  runtime.ingest(action);
  runtime.ingest(segment);
  runtime.stop();
  queued[0]?.onstart?.();
  expect(execute).not.toHaveBeenCalled();
});

it("PRD §9 native start events fire the same sentence actions without browser audio", () => {
  const host = {
    webkit: { messageHandlers: { lotse: { postMessage: vi.fn().mockResolvedValue(undefined) } } },
    __lotse: { receive: (_raw: unknown): void => {} },
  };
  vi.stubGlobal("window", host);
  const execute = vi.fn();
  const runtime = new GuidanceRuntime(execute);
  const disconnect = runtime.connect();
  host.__lotse.receive({
    v: "1.0.0",
    id: "hello",
    type: "BridgeHello",
    payload: {
      appVersion: "0.1.0",
      protocolVersion: "1.0.0",
      capabilities: {
        accessibility: false,
        ocr: true,
        onDeviceContextSize: 0,
        onDeviceModel: false,
        overlay: true,
      },
    },
  });
  runtime.ingest(action);
  runtime.ingest(segment);
  expect(execute).not.toHaveBeenCalled();
  host.__lotse.receive({
    v: "1.0.0",
    id: "started",
    type: "SpeechControl",
    payload: { segmentIndex: 0, stop: false, state: "speaking" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    host.webkit.messageHandlers.lotse.postMessage.mock.calls.map(([message]) => message.type),
  ).not.toContain("Action");
  host.__lotse.receive({
    v: "1.0.0",
    id: "idle",
    type: "SpeechControl",
    payload: { segmentIndex: 0, stop: false, state: "idle" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  disconnect();
});

it("FR-D4 reports successful source resolution with the next turn without retaining old results", () => {
  const runtime = new GuidanceRuntime(vi.fn());
  runtime.recordResult({
    actionId: "mark",
    resolvedBy: "ocr",
    confidence: 0,
    success: false,
    failureReason: "TEXT_NOT_FOUND",
  });
  runtime.recordResult({ actionId: "mark", resolvedBy: "ui", confidence: 1, success: true });
  runtime.recordResult({
    actionId: "mark",
    resolvedBy: "ocr",
    confidence: 0,
    success: false,
    failureReason: "TEXT_NOT_FOUND",
  });
  expect(runtime.takeActionResults()).toEqual([
    { actionId: "mark", resolvedBy: "ui", confidence: 1, success: true },
  ]);
  expect(runtime.takeActionResults()).toEqual([]);
});

it("native dashboard transcripts reach only the workspace conversation client", () => {
  const previous = vi.fn();
  const host = {
    location: { pathname: "/workspace" },
    dispatchEvent: vi.fn(),
    __lotse: { receive: previous },
  };
  vi.stubGlobal("window", host);
  const runtime = new GuidanceRuntime(vi.fn());
  const disconnect = runtime.connect();
  const transcript = {
    v: "1.0.0",
    id: "transcript",
    type: "Transcript",
    payload: { text: "Bitte meine Unterlagen öffnen.", final: true, language: "de", capsule: {} },
  };
  host.__lotse.receive(transcript);
  expect(previous).toHaveBeenCalledWith(transcript);
  expect(host.dispatchEvent).not.toHaveBeenCalled();
  disconnect();
});

it("typed turns are not read aloud but still run their sentence actions", () => {
  const queued: TestUtterance[] = [];
  vi.stubGlobal("SpeechSynthesisUtterance", TestUtterance);
  vi.stubGlobal("window", {
    speechSynthesis: {
      speak: (utterance: TestUtterance) => queued.push(utterance),
      cancel: vi.fn(),
    },
  });
  const execute = vi.fn();
  const runtime = new GuidanceRuntime(execute);
  runtime.beginTurn(false);
  runtime.ingest(action);
  runtime.ingest(segment);
  expect(queued).toHaveLength(0);
  expect(execute).toHaveBeenCalledTimes(1);
  runtime.beginTurn(true);
  runtime.ingest({ ...segment, data: { ...segment.data, turnId: "spoken", actionIds: [] } });
  expect(queued).toHaveLength(1);
});
