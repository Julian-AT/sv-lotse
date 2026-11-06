"use client";

import { useChat } from "@ai-sdk/react";
import type { LotseMessage } from "@lotse/brain";
import {
  ActionResultSchema,
  type BridgeToWorkspace,
  ContextCapsuleSchema,
  DATA_PARTS,
  type LotseDataParts,
} from "@lotse/protocol";
import {
  type ChatAddToolOutputFunction,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { useEffect, useRef, useState } from "react";
import { postNative, reportBridgeError, subscribeBridge } from "../bridge/index.ts";
import { AUTONOMY_CHANGED_EVENT } from "../features/autonomy/config.ts";
import { receiveFormViewerBridgeMessage } from "../features/form-viewer/bridge.ts";
import { stopFormFilling } from "../features/form-viewer/config.ts";
import { useGuidance } from "../speech/provider.tsx";
import { type ClientRuntime, createClientRuntime, nativeEnvelope } from "./client-tools.ts";
import {
  nativePageCapsule,
  receiveNativeActionResult,
  receiveNativePage,
} from "./open-resource.ts";
import { createTurnTransport, type TurnState } from "./transport.ts";

export function openingResource(pending: ReadonlyMap<string, string>): boolean {
  return [...pending.values()].includes("ui.openResource");
}

type Options = {
  caseId: string;
  language: string;
  initialMessages: LotseMessage[];
  onSettled: () => void;
};

export function useConversation({
  caseId,
  language,
  initialMessages,
  onSettled,
}: Options): ReturnType<typeof useChat<LotseMessage>> & {
  send: (text: string, reply?: boolean) => Promise<void>;
  partial: string;
  bridgeError: boolean;
  statusLine: string;
} {
  const guidance = useGuidance();
  const guidanceRef = useRef(guidance);
  guidanceRef.current = guidance;
  const [partial, setPartial] = useState("");
  // Fixed progress line ("Ich schaue das kurz nach …") while a slow tool step runs.
  const [statusLine, setStatusLine] = useState("");
  const [bridgeError, setBridgeError] = useState(false);
  const [turnState] = useState<TurnState>(() => ({
    caseId,
    inputKind: "text",
    language,
    capsule: {},
    actionResults: [],
  }));
  const [transport] = useState(() => createTurnTransport<LotseMessage>(turnState, onSettled));
  const runtime = useRef<ClientRuntime | undefined>(undefined);
  const pending = useRef(new Map<string, string>());
  const output = useRef<ChatAddToolOutputFunction<LotseMessage>>(() => {});
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const chat = useChat<LotseMessage>({
    transport,
    messages: initialMessages,
    dataPartSchemas: DATA_PARTS,
    sendAutomaticallyWhen: (options) =>
      lastAssistantMessageIsCompleteWithApprovalResponses(options) ||
      lastAssistantMessageIsCompleteWithToolCalls(options),
    onFinish: () => {
      window.dispatchEvent(new Event(AUTONOMY_CHANGED_EVENT));
      onSettled();
    },
    onToolCall: async ({ toolCall }) => {
      if (
        ![
          "context.readPage",
          "context.readScreen",
          "ui.fill",
          "ui.click",
          "ui.scroll",
          "ui.openResource",
          "calendar.createEvent",
          "session.shareWithHelper",
        ].includes(toolCall.toolName)
      )
        return;
      if (pending.current.has(toolCall.toolCallId)) return;
      pending.current.set(toolCall.toolCallId, toolCall.toolName);
      const started = generation.current;
      try {
        const result = await runtime.current?.execute(
          toolCall.toolCallId,
          toolCall.toolName,
          toolCall.input,
        );
        if (result && "native" in result) return;
        pending.current.delete(toolCall.toolCallId);
        // A newer message superseded this call on the server; its late output must not resend.
        if (generation.current !== started) return;
        if (result && "output" in result)
          void output.current({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            output: result.output,
          });
        else
          void output.current({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: result?.errorText ?? "CLIENT_TOOL_UNAVAILABLE",
          });
      } catch {
        pending.current.delete(toolCall.toolCallId);
        void output.current({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: "CLIENT_TOOL_FAILED",
        });
      }
    },
    onData: (part) => {
      const version = generation.current;
      if (part.type === "data-status") {
        // The brain speaks the status line itself as the first sentence of a voice turn.
        setStatusLine(part.data.text);
        return;
      }
      queue.current = queue.current
        .then(async () => {
          if (version !== generation.current) return;
          if (part.type === "data-action") {
            const result = await runtime.current?.action(part.data);
            if (result) turnState.actionResults.push(result);
            return;
          }
          if (!turnState.hello) return;
          switch (part.type) {
            case "data-speech-segment":
              // Typed turns stay silent; only a spoken question gets a spoken answer.
              if (speaksAloud(turnState.inputKind))
                await postNative(nativeEnvelope("SpeechSegment", part.data));
              break;
            case "data-approval-context":
              await postNative(nativeEnvelope("ApprovalContext", part.data));
              break;
            case "data-job-progress":
              await postNative(nativeEnvelope("JobProgress", part.data));
              break;
            case "data-safety-notice":
              await postNative(nativeEnvelope("SafetyNotice", part.data));
              break;
          }
        })
        .catch((error: unknown) => {
          reportBridgeError(`data part ${part.type}`, error);
          setBridgeError(true);
        });
    },
    onError: (error) => reportBridgeError("conversation stream", error),
  });
  output.current = chat.addToolOutput;
  const currentChat = useRef(chat);
  currentChat.current = chat;
  turnState.language = language;

  useEffect(() => {
    guidanceRef.current.setCaseId(caseId);
    runtime.current = createClientRuntime({
      openDocumentHighlight: (action) => guidanceRef.current.highlightDocument(action),
    });
    const received = new Set<string>();
    const receive = async (message: BridgeToWorkspace): Promise<void> => {
      if (received.has(message.id)) return;
      received.add(message.id);
      receiveFormViewerBridgeMessage(message);
      const current = currentChat.current;
      switch (message.type) {
        case "BridgeHello":
          turnState.hello = message.payload;
          break;
        case "Transcript": {
          setPartial(message.payload.final ? "" : message.payload.text);
          if (!message.payload.final || !message.payload.text.trim()) return;
          generation.current++;
          await current.stop();
          stopFormFilling();
          runtime.current?.clear();
          turnState.inputKind = "transcript";
          turnState.language = message.payload.language ?? language;
          turnState.capsule = message.payload.capsule ?? {};
          await current.sendMessage({ text: message.payload.text });
          break;
        }
        case "ApprovalDecision": {
          const decision = message.payload;
          const matching = current.messages
            .at(-1)
            ?.parts.find(
              (part) =>
                isToolUIPart(part) &&
                part.state === "approval-requested" &&
                part.approval.id === decision.approvalId,
            );
          if (!matching || (isToolUIPart(matching) && getToolName(matching) === "form.commitGroup"))
            return;
          await current.addToolApprovalResponse({
            id: decision.approvalId,
            approved: decision.approved,
            ...(decision.reason === undefined ? {} : { reason: decision.reason }),
          });
          break;
        }
        case "ToolOutput": {
          if (receiveNativePage(message.payload.toolCallId, message.payload.output)) return;
          const toolName = pending.current.get(message.payload.toolCallId);
          if (!toolName) return;
          const result = (
            toolName === "context.readScreen" || toolName === "context.readPage"
              ? ContextCapsuleSchema
              : ActionResultSchema
          ).safeParse(message.payload.output);
          pending.current.delete(message.payload.toolCallId);
          if (!result.success || message.payload.error)
            void output.current({
              tool: toolName,
              toolCallId: message.payload.toolCallId,
              state: "output-error",
              errorText: "NATIVE_TOOL_FAILED",
            });
          else
            void output.current({
              tool: toolName,
              toolCallId: message.payload.toolCallId,
              output: result.data,
            });
          break;
        }
        case "ActionResult":
          if (receiveNativeActionResult(message.payload)) break;
          turnState.actionResults.push(message.payload);
          break;
        case "SpeechControl":
          // A speech stop while a page is opening must not abort the turn: the open result
          // continues the conversation, and an aborted turn never sends its tool output.
          if (message.payload.stop && !openingResource(pending.current)) {
            generation.current++;
            await current.stop();
            stopFormFilling();
            runtime.current?.clear();
          }
          break;
      }
    };
    const uninstall = subscribeBridge(receive);
    return () => {
      uninstall();
      generation.current++;
      stopFormFilling();
      runtime.current?.dispose();
      void currentChat.current.stop();
      if (turnState.hello)
        void postNative(
          nativeEnvelope("SpeechControl", { stop: true, state: "idle", segmentIndex: 0 }),
        ).catch(() => undefined);
    };
  }, [caseId, language, turnState]);

  const stop = async (): Promise<void> => {
    generation.current++;
    pending.current.clear();
    stopFormFilling();
    await chat.stop();
    runtime.current?.clear();
    if (turnState.hello)
      await postNative(
        nativeEnvelope("SpeechControl", { stop: true, state: "idle", segmentIndex: 0 }),
      ).catch((error: unknown) => {
        reportBridgeError("SpeechControl", error);
        setBridgeError(true);
      });
  };
  const send = async (text: string, reply = false): Promise<void> => {
    setStatusLine("");
    await stop();
    turnState.actionResults.push(...guidanceRef.current.takeActionResults());
    turnState.inputKind = sentInputKind(turnState.inputKind, reply);
    turnState.capsule = await nativePageCapsule();
    await chat.sendMessage({ text });
  };
  useEffect(() => {
    if (chat.status === "ready" || chat.status === "error") setStatusLine("");
  }, [chat.status]);
  return {
    ...chat,
    send,
    stop,
    partial,
    bridgeError,
    statusLine: chat.status === "ready" || chat.status === "error" ? "" : statusLine,
  };
}

/** Typed messages are silent; a reply chip ("Ja, öffnen") keeps a spoken conversation spoken. */
export function sentInputKind(
  current: TurnState["inputKind"],
  reply: boolean,
): TurnState["inputKind"] {
  return reply ? current : "text";
}

/** Only turns asked by voice (⌥⌘, „Meine SV“, the mic button) are read aloud. */
export function speaksAloud(inputKind: TurnState["inputKind"]): boolean {
  return inputKind === "transcript";
}

export function approvalContexts(messages: LotseMessage[]): LotseDataParts["approval-context"][] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "data-approval-context" ? [part.data] : [])),
  );
}

export function pendingApprovals(
  message: LotseMessage,
): { toolCallId: string; toolName: string; approvalId: string }[] {
  return message.parts.flatMap((part) =>
    isToolUIPart(part) && part.state === "approval-requested"
      ? [{ toolCallId: part.toolCallId, toolName: getToolName(part), approvalId: part.approval.id }]
      : [],
  );
}
