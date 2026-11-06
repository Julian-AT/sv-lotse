"use client";

import { type UseChatHelpers, useChat } from "@ai-sdk/react";
import type { LotseMessage } from "@lotse/brain";
import { DATA_PARTS, type JobProgress } from "@lotse/protocol";
import {
  type ChatOnToolCallCallback,
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";
import { SESSION_RESET_EVENT } from "../config.ts";
import { AUTONOMY_CHANGED_EVENT } from "../features/autonomy/config.ts";
import { loadConversation } from "./load.ts";

export type CaseConversation = UseChatHelpers<LotseMessage> & {
  loaded: boolean;
  loadFailed: boolean;
  reload: () => void;
  jobs: JobProgress[];
  setJobs: Dispatch<SetStateAction<JobProgress[]>>;
};
export function useCaseConversation(
  caseId: string,
  language: "de" | "en",
  onClientTool?: ChatOnToolCallCallback<LotseMessage>,
): CaseConversation {
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadRequest, setLoadRequest] = useState(() => new AbortController());
  useEffect(() => {
    const reset = (): void => setLoadRequest(new AbortController());
    window.addEventListener(SESSION_RESET_EVENT, reset);
    return () => window.removeEventListener(SESSION_RESET_EVENT, reset);
  }, []);
  const [jobs, setJobs] = useState<JobProgress[]>([]);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<LotseMessage>({
        api: "/api/turn",
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            caseId,
            language,
            inputKind: "text",
            capsule: {},
            actionResults: [],
            message: messages.at(-1),
          },
        }),
      }),
    [caseId, language],
  );
  const chat = useChat<LotseMessage>({
    id: caseId,
    transport,
    dataPartSchemas: DATA_PARTS,
    onFinish: () => {
      window.dispatchEvent(new Event(AUTONOMY_CHANGED_EVENT));
    },
    sendAutomaticallyWhen: (options) =>
      lastAssistantMessageIsCompleteWithApprovalResponses(options) ||
      lastAssistantMessageIsCompleteWithToolCalls(options),
    onData: (part) => {
      if (part.type === "data-job-progress")
        setJobs((previous) => [
          ...previous.filter((job) => job.jobId !== part.data.jobId),
          part.data,
        ]);
    },
    onToolCall: (options) => {
      if (onClientTool) return onClientTool(options);
      // A standalone history view has no native capability adapter. Report a
      // real unavailable capability instead of leaving a consumed call pending.
      void chat.addToolOutput({
        tool: options.toolCall.toolName,
        toolCallId: options.toolCall.toolCallId,
        state: "output-error",
        errorText: "CLIENT_CAPABILITY_UNAVAILABLE",
      });
    },
  });
  const { setMessages } = chat;
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(false);
    setLoadFailed(false);
    void loadConversation(caseId, AbortSignal.any([controller.signal, loadRequest.signal]))
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setMessages(snapshot.messages);
        setJobs(snapshot.jobs.map((part) => part.data));
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [caseId, loadRequest, setMessages]);
  return {
    ...chat,
    loaded,
    loadFailed,
    jobs,
    setJobs,
    reload: () => setLoadRequest(new AbortController()),
  };
}
