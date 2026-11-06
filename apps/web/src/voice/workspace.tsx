"use client";

import { useChat } from "@ai-sdk/react";
import { createGuide, type Guide, toCapsulePage } from "@lotse/guide";
import {
  type Action,
  type ActionResult,
  DATA_PARTS,
  type LotseDataParts,
  type TurnRequest,
} from "@lotse/protocol";
import { DefaultChatTransport, type UIMessage } from "ai";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { voiceConfig } from "./config.ts";
import { VoiceControls } from "./controls.tsx";
import { type VoiceLanguage, voiceCopy } from "./copy.ts";
import { completedTextSegments } from "./text-segments.ts";
import { type BrowserVoice, useBrowserVoice } from "./use-browser-voice.ts";
import styles from "./voice.module.css";

type WorkspaceMessage = UIMessage<unknown, LotseDataParts>;

export function VoiceWorkspace({ language }: { language: VoiceLanguage }): ReactElement {
  const copy = voiceCopy[language];
  const [input, setInput] = useState("");
  const caseId = useRef<string | undefined>(undefined);
  const inputKind = useRef<TurnRequest["inputKind"]>("text");
  const inputLanguage = useRef<string>(language);
  const guide = useRef<Guide | undefined>(undefined);
  const results = useRef<ActionResult[]>([]);
  const actionQueue = useRef(Promise.resolve());
  const generation = useRef(0);
  const voiceRef = useRef<BrowserVoice | undefined>(undefined);
  const streamedSpeech = useRef(false);
  const [transport] = useState(
    () =>
      new DefaultChatTransport<WorkspaceMessage>({
        api: voiceConfig.turnEndpoint,
        credentials: "same-origin",
        fetch: async (url, options) => {
          const response = await fetch(url, options);
          const id = response.headers.get("x-lotse-case-id");
          if (response.ok && id) caseId.current = id;
          return response;
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            ...(caseId.current ? { caseId: caseId.current } : {}),
            inputKind: inputKind.current,
            language: inputLanguage.current,
            capsule: guide.current ? { page: toCapsulePage(guide.current.snapshot()) } : {},
            actionResults: results.current.splice(0),
            message: messages.at(-1),
          },
        }),
      }),
  );
  const chat = useChat<WorkspaceMessage>({
    transport,
    dataPartSchemas: DATA_PARTS,
    onData: (part) => {
      if (part.type === "data-speech-segment") streamedSpeech.current = true;
      voiceRef.current?.receive(part);
    },
    onFinish: ({ message, isAbort, isDisconnect, isError }) => {
      if (streamedSpeech.current || isAbort || isDisconnect || isError) return;
      for (const segment of completedTextSegments(message, inputLanguage.current))
        voiceRef.current?.receive({ type: "data-speech-segment", data: segment });
    },
  });
  const voice = useBrowserVoice({
    language,
    onTranscript: (text, detectedLanguage) => send(text, "transcript", detectedLanguage),
    onAction: execute,
    onInterrupt: () => {
      void chat.stop();
      generation.current++;
      guide.current?.clear();
    },
  });
  voiceRef.current = voice;

  useEffect(() => {
    // Browser-only targets are confined to the workspace; approved values remain previews.
    guide.current = createGuide({ allowlist: [window.location.origin], ghostPreview: true });
    const cancel = () => {
      voiceRef.current?.cancel();
      voiceRef.current?.stop();
    };
    window.addEventListener("blur", cancel);
    const visibility = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", visibility);
      guide.current?.dispose();
    };
  }, []);

  function execute(action: Action): void {
    const current = generation.current;
    actionQueue.current = actionQueue.current
      .then(async () => {
        if (current !== generation.current) return;
        const result = await guide.current?.execute(action);
        if (result) results.current.push(result);
      })
      .catch(() => undefined);
  }

  function send(text: string, kind: TurnRequest["inputKind"], detectedLanguage?: string): void {
    if (!text.trim()) return;
    voiceRef.current?.stop();
    voiceRef.current?.beginTurn();
    voiceRef.current?.unlock();
    inputKind.current = kind;
    streamedSpeech.current = false;
    inputLanguage.current = detectedLanguage ?? language;
    setInput("");
    void chat.sendMessage({ text }).catch(() => undefined);
  }

  const pending = chat.status === "submitted" || chat.status === "streaming";
  return (
    <div>
      <VoiceControls voice={voice} language={language} />
      <ol className={styles.messages}>
        {chat.messages.map((message) => (
          <li key={message.id}>
            <strong>{message.role === "user" ? copy.you : copy.assistant}</strong>
            <p>
              {message.parts
                .flatMap((part) => (part.type === "text" ? [part.text] : []))
                .join("\n")}
            </p>
          </li>
        ))}
      </ol>
      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) send(input, "text");
        }}
      >
        <label htmlFor="voice-message">{copy.message}</label>
        <textarea
          id="voice-message"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={pending || !input.trim()}>
          {copy.send}
        </button>
      </form>
      {pending ? <p role="status">{copy.busy}</p> : null}
      {chat.error ? <p role="alert">{copy.turnError}</p> : null}
    </div>
  );
}
