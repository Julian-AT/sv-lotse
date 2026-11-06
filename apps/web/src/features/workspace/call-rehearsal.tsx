"use client";

import {
  type AppointmentRehearsal,
  appointmentRehearsalSchema,
} from "@lotse/brain/workspace/schema";
import { type JSX, useEffect, useRef, useState } from "react";
import { BrowserRecognition, type RecordingState } from "@/voice/recognition.ts";
import { BrowserSpeech } from "@/voice/synthesis.ts";
import { APPOINTMENT_REHEARSE_URL } from "./config.ts";
import type { WorkspaceCopy, WorkspaceLanguage } from "./copy.ts";
import styles from "./workspace.module.css";

type Round = { office: string; hint: string };
function rounds(script: AppointmentRehearsal["script"]): Round[] {
  const result: Round[] = [];
  for (const line of script) {
    if (line.role === "office") result.push({ office: line.text, hint: "" });
    else {
      const last = result.at(-1);
      if (last) last.hint = [last.hint, line.text].filter(Boolean).join("\n");
    }
  }
  return result;
}

type Phase = "idle" | "loading" | "speaking" | "reply" | "done";

export function CallRehearsal({
  caseId,
  facilityId,
  benefitId,
  language,
  copy,
}: {
  caseId: string;
  facilityId: string;
  benefitId: string | null;
  language: WorkspaceLanguage;
  copy: WorkspaceCopy;
}): JSX.Element {
  const [rehearsal, setRehearsal] = useState<AppointmentRehearsal | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [index, setIndex] = useState(0);
  const [reply, setReply] = useState("");
  const [replies, setReplies] = useState<{ id: string; office: string; text: string }[]>([]);
  const [recording, setRecording] = useState<RecordingState>("idle");
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState(false);
  const speech = useRef<BrowserSpeech | null>(null);
  const recognition = useRef<BrowserRecognition | null>(null);
  const request = useRef<AbortController | null>(null);
  const script = rehearsal ? rounds(rehearsal.script) : [];
  const round = script[index];

  useEffect(() => {
    speech.current = new BrowserSpeech({
      start: () => undefined,
      speaking: () => undefined,
      complete: () => setPhase((current) => (current === "speaking" ? "reply" : current)),
      fallback: () => setFallback(true),
    });
    recognition.current = new BrowserRecognition({
      state: setRecording,
      partial: setReply,
      final: setReply,
      fallback: () => setFallback(true),
    });
    return () => {
      request.current?.abort();
      recognition.current?.cancel();
      speech.current?.dispose();
    };
  }, []);

  const office = round?.office;
  useEffect(() => {
    if (!office || !rehearsal) return;
    setPhase("speaking");
    const output = speech.current;
    output?.enqueue({
      turnId: crypto.randomUUID(),
      index,
      text: office,
      language: language === "de" ? "de-AT" : "en",
      actionIds: [],
      citations: [],
    });
    return () => output?.stop();
  }, [office, index, language, rehearsal]);

  async function start(): Promise<void> {
    speech.current?.unlock();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRehearsal(null);
    setPhase("loading");
    setError(false);
    setFallback(false);
    setReply("");
    setReplies([]);
    setIndex(0);
    try {
      const response = await fetch(APPOINTMENT_REHEARSE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, facilityId, language, ...(benefitId ? { benefitId } : {}) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("REHEARSAL_UNAVAILABLE");
      const result = appointmentRehearsalSchema.parse(await response.json());
      if (controller.signal.aborted) return;
      setRehearsal(result);
      if (!rounds(result.script).length) setPhase("done");
    } catch {
      if (controller.signal.aborted) return;
      setError(true);
      setPhase("idle");
    }
  }

  function stop(): void {
    request.current?.abort();
    recognition.current?.cancel();
    speech.current?.stop();
    setRehearsal(null);
    setReplies([]);
    setReply("");
    setPhase("idle");
  }

  function sendReply(): void {
    if (
      !round ||
      phase !== "reply" ||
      !reply.trim() ||
      (recording !== "idle" && recording !== "error")
    )
      return;
    recognition.current?.cancel();
    setReplies((previous) => [
      ...previous,
      { id: crypto.randomUUID(), office: round.office, text: reply.trim() },
    ]);
    setReply("");
    setIndex((previous) => previous + 1);
    setPhase(index + 1 >= script.length ? "done" : "speaking");
  }

  const active = phase === "speaking" || phase === "reply";
  const recordingActive = recording === "connecting" || recording === "listening";
  return (
    <section className={styles.card} aria-labelledby="call-rehearsal-title">
      <h2 id="call-rehearsal-title">{copy.rehearse}</h2>
      <p>{copy.rehearsalHelp}</p>
      {phase === "idle" || phase === "done" ? (
        <button type="button" onClick={() => void start()}>
          {copy.rehearse}
        </button>
      ) : (
        <button type="button" onClick={stop}>
          {copy.rehearsalStop}
        </button>
      )}
      {phase === "loading" && <p role="status">{copy.rehearsalLoading}</p>}
      {error && <p role="alert">{copy.error}</p>}
      {rehearsal && <p>{rehearsal.notice}</p>}
      {rehearsal && (
        <details>
          <summary>{copy.callSheet}</summary>
          <p className={styles.preformatted}>{rehearsal.callSheet}</p>
        </details>
      )}
      <ol>
        {replies.map((entry) => (
          <li key={entry.id}>
            <p>
              {copy.rehearsalOffice}: {entry.office}
            </p>
            <p>
              {copy.rehearsalCaller}: {entry.text}
            </p>
          </li>
        ))}
      </ol>
      {active && round && (
        <>
          <p role="status">
            {copy.rehearsalOffice}: {round.office}
          </p>
          <p>{phase === "speaking" ? copy.rehearsalSpeaking : copy.rehearsalWaiting}</p>
          {phase === "speaking" && (
            <button
              type="button"
              onClick={() => {
                speech.current?.stop();
                setPhase("reply");
              }}
            >
              {copy.rehearsalSkipAudio}
            </button>
          )}
          <details>
            <summary>{copy.rehearsalHint}</summary>
            <p>{round.hint}</p>
          </details>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              sendReply();
            }}
          >
            <div className={styles.field}>
              <label htmlFor="rehearsal-reply">{copy.rehearsalReply}</label>
              <textarea
                id="rehearsal-reply"
                value={reply}
                disabled={phase !== "reply"}
                onChange={(event) => setReply(event.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={phase !== "reply" || recording === "processing"}
                aria-pressed={recordingActive}
                onClick={() =>
                  recordingActive
                    ? recognition.current?.release()
                    : void recognition.current?.start(language)
                }
              >
                {recordingActive ? copy.rehearsalFinishSpeaking : copy.rehearsalSpeak}
              </button>
              <button
                type="submit"
                disabled={
                  phase !== "reply" ||
                  !reply.trim() ||
                  (recording !== "idle" && recording !== "error")
                }
              >
                {copy.rehearsalSend}
              </button>
            </div>
          </form>
          {recording === "error" && <p role="alert">{copy.rehearsalVoiceError}</p>}
        </>
      )}
      {fallback && <p role="status">{copy.rehearsalVoiceFallback}</p>}
      {phase === "done" && <p role="status">{copy.rehearsalDone}</p>}
    </section>
  );
}
