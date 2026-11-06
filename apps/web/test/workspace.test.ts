import { parseTurnBody } from "@lotse/brain";
import { PROTOCOL_VERSION } from "@lotse/protocol";
import type { UIMessage } from "ai";
import { afterEach, expect, test, vi } from "vitest";
import {
  installBridge,
  mountWorkspaceBridge,
  postNative,
  subscribeBridge,
} from "../src/bridge/index.ts";
import { WORKSPACE_CONFIG } from "../src/conversation/config.ts";
import { parseHistory } from "../src/conversation/history.ts";
import {
  createTurnTransport,
  latestTurnBody,
  type TurnState,
} from "../src/conversation/transport.ts";

afterEach(() => vi.unstubAllGlobals());

test("§6 a new persisted case opens with an empty conversation history", async () => {
  expect(await parseHistory({ messages: [] })).toEqual([]);
  await expect(parseHistory({ messages: [{ role: "forged", parts: [] }] })).rejects.toThrow();
});

test("§9 transport sends only the latest message and a schema-valid protocol request", () => {
  const messages: UIMessage[] = [
    { id: "earlier", role: "user", parts: [{ type: "text", text: "Earlier statement" }] },
    { id: "latest", role: "user", parts: [{ type: "text", text: "Current statement" }] },
  ];
  const state: TurnState = { inputKind: "text", language: "en", capsule: {}, actionResults: [] };
  const body = latestTurnBody(messages, state);
  expect(body.message).toEqual(messages[1]);
  expect(body).not.toHaveProperty("messages");
  expect(body).not.toHaveProperty("autonomyLevel");
  expect(parseTurnBody(body).latestMessage).toEqual(messages[1]);
});

test("§9 approval continuation sends the latest assistant message with the approval response", () => {
  const message: UIMessage = {
    id: "approval-message",
    role: "assistant",
    parts: [
      {
        type: "dynamic-tool",
        toolName: "ui.fill",
        toolCallId: "call",
        state: "approval-responded",
        input: {},
        approval: { id: "approval", approved: false },
      },
    ],
  };
  const body = latestTurnBody([message], {
    inputKind: "text",
    language: "de",
    capsule: {},
    actionResults: [],
  });
  expect(body.message).toEqual(message);
});

test("§9 the next request retains the server-issued case id", async () => {
  const caseId = crypto.randomUUID();
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response("data: [DONE]\n\n", {
        headers: { "x-lotse-case-id": caseId, "Content-Type": "text/event-stream" },
      });
    }),
  );
  const state: TurnState = { inputKind: "text", language: "en", capsule: {}, actionResults: [] };
  const onCase = vi.fn();
  const transport = createTurnTransport(state, onCase);
  const send = () =>
    transport.sendMessages({
      trigger: "submit-message",
      chatId: "local",
      messageId: undefined,
      abortSignal: undefined,
      messages: [{ id: "current", role: "user", parts: [{ type: "text", text: "A statement" }] }],
    });
  await send();
  await send();
  expect(requests[0]).not.toHaveProperty("caseId");
  expect(requests[1]?.caseId).toBe(caseId);
  expect(onCase).toHaveBeenCalledWith(caseId);
});

test("§9 native boundaries reject malformed envelopes before executing callbacks", async () => {
  vi.stubGlobal("window", {});
  const receiver = vi.fn();
  const uninstall = installBridge(receiver);
  await expect(
    window.__lotse?.receive({ type: "Transcript", payload: { text: "ignored" } }),
  ).rejects.toThrow();
  expect(receiver).not.toHaveBeenCalled();
  uninstall();
  expect(window.__lotse).toBeUndefined();
});

test("§9 native handshake is received while case history loads and replays before transcripts", async () => {
  vi.stubGlobal("window", {});
  const unmount = mountWorkspaceBridge();
  const hello = {
    v: PROTOCOL_VERSION,
    type: "BridgeHello",
    id: "hello",
    payload: {
      appVersion: WORKSPACE_CONFIG.appVersion,
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        overlay: true,
        accessibility: true,
        ocr: true,
        onDeviceModel: false,
        onDeviceContextSize: 0,
      },
    },
  };
  await window.__lotse?.receive(hello);
  await window.__lotse?.receive({
    v: PROTOCOL_VERSION,
    type: "Transcript",
    id: "transcript",
    payload: { text: "Please help with my application", final: true },
  });
  const received: string[] = [];
  const unsubscribe = subscribeBridge((message) => {
    received.push(message.type);
  });
  await vi.waitFor(() => expect(received).toEqual(["BridgeHello", "Transcript"]));
  unsubscribe();
  unmount();
});

test("§9 native posts use the protocol envelope and the WK reply handler", async () => {
  const handler = vi.fn(async () => undefined);
  vi.stubGlobal("window", { webkit: { messageHandlers: { lotse: { postMessage: handler } } } });
  const message = {
    v: PROTOCOL_VERSION,
    id: "stop",
    type: "SpeechControl" as const,
    payload: { stop: true, state: "idle" as const, segmentIndex: 0 },
  };
  await postNative(message);
  expect(handler).toHaveBeenCalledWith(message);
});
