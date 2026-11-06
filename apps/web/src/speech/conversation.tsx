"use client";

import { TranscriptSchema } from "@lotse/protocol";
import { usePathname } from "next/navigation";
import { type FormEvent, type JSX, useEffect, useRef, useState } from "react";
import { viewerCopy } from "../features/viewer/copy.ts";
import styles from "../features/viewer/viewer.module.css";
import { GUIDANCE_TRANSCRIPT_EVENT, PAGE_CONVERSATION_ROUTES, TURN_URL } from "./config.ts";
import { useGuidance } from "./provider.tsx";
import { consumeGuidanceResponse } from "./stream.ts";

export function pageOwnsConversation(pathname: string | null): boolean {
  return pathname !== null && PAGE_CONVERSATION_ROUTES.some((route) => route.test(pathname));
}

/** The layout's conversation, mounted only where the page does not host its own. */
export function LayoutGuidanceConversation({
  language,
}: {
  language: "de" | "en";
}): JSX.Element | null {
  return pageOwnsConversation(usePathname()) ? null : <GuidanceConversation language={language} />;
}

export function GuidanceConversation({ language }: { language: "de" | "en" }): JSX.Element {
  const guidance = useGuidance();
  const [input, setInput] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const caseId = useRef<string | undefined>(undefined);
  const pending = useRef<AbortController | null>(null);
  const copy = viewerCopy[language];
  async function send(
    text: string,
    inputKind: "text" | "transcript",
    capsule: object = {},
  ): Promise<void> {
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    const selectedCase = new URL(window.location.href).searchParams.get("caseId") ?? caseId.current;
    if (selectedCase) guidance.setCaseId(selectedCase);
    guidance.beginTurn();
    setBusy(true);
    setError(false);
    setReply("");
    try {
      const response = await fetch(TURN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          ...(selectedCase ? { caseId: selectedCase } : {}),
          inputKind,
          language,
          capsule,
          actionResults: guidance.takeActionResults(),
          message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] },
        }),
      });
      const nextCase = response.headers.get("x-lotse-case-id");
      if (nextCase) {
        caseId.current = nextCase;
        guidance.setCaseId(nextCase);
      }
      await consumeGuidanceResponse(response, guidance.ingest, (delta) =>
        setReply((previous) => previous + delta),
      );
    } catch {
      if (!abort.signal.aborted) setError(true);
    } finally {
      if (pending.current === abort) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const transcript = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = TranscriptSchema.safeParse(event.detail);
      if (parsed.success && parsed.data.final)
        void sendRef.current(parsed.data.text, "transcript", parsed.data.capsule);
    };
    window.addEventListener(GUIDANCE_TRANSCRIPT_EVENT, transcript);
    return () => {
      pending.current?.abort();
      window.removeEventListener(GUIDANCE_TRANSCRIPT_EVENT, transcript);
    };
  }, []);
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!input.trim()) return;
    void send(input, "text");
    setInput("");
  }
  return (
    <form className={styles.conversation} onSubmit={submit}>
      <label htmlFor="guidance-message">{copy.message}</label>
      <textarea
        id="guidance-message"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <button type="submit" disabled={busy || !input.trim()}>
        {copy.send}
      </button>
      {reply && <p className={styles.caption}>{reply}</p>}
      {error && <p role="alert">{copy.turnError}</p>}
    </form>
  );
}
