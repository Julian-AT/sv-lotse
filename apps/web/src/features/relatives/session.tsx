"use client";
import dynamic from "next/dynamic";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { type BrowserRelativeSession, browserSessionSchema, relativeRequest } from "./api.ts";
import { RELATIVE_POLL_MS } from "./config.ts";
import type { RelativesCopy } from "./copy.ts";
import { RelativeJourney } from "./journey.tsx";
import styles from "./relatives.module.css";

const RelativeRoom = dynamic(() => import("./room.tsx").then((module) => module.RelativeRoom), {
  ssr: false,
});
export function RelativeSessionPanel({
  id,
  participantRole,
  copy,
}: {
  id: string;
  participantRole: "subject" | "helper";
  copy: RelativesCopy;
}): ReactElement {
  const [session, setSession] = useState<BrowserRelativeSession | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const ended = useRef(false);
  useEffect(() => {
    ended.current = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (): Promise<void> => {
      try {
        const result = await relativeRequest(
          `/api/relatives/session?id=${encodeURIComponent(id)}`,
          browserSessionSchema,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted || ended.current) return;
        setSession(result);
        setError(false);
        if (result.state === "ended") return;
      } catch {
        if (controller.signal.aborted || ended.current) return;
        setError(true);
        setSession(null);
      }
      timer = setTimeout(() => void poll(), RELATIVE_POLL_MS);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);

  async function act(action: "approve" | "pause" | "resume" | "end"): Promise<void> {
    setBusy(true);
    if (action === "end") {
      ended.current = true;
      setSession(null);
    }
    try {
      setSession(
        await relativeRequest("/api/relatives/session", browserSessionSchema, { id, action }),
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {session?.state === "invited" ? <p role="status">{copy.waiting}</p> : null}
      {session?.state === "pending" ? (
        <>
          <p role="status">{participantRole === "subject" ? copy.pending : copy.approval}</p>
          {participantRole === "subject" ? (
            <div className={styles.controls}>
              <button type="button" disabled={busy} onClick={() => void act("approve")}>
                {copy.approve}
              </button>
              <button type="button" disabled={busy} onClick={() => void act("end")}>
                {copy.deny}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {session?.state === "approved" && session.caseShared && participantRole === "helper" ? (
        <RelativeJourney caseId={session.caseId} copy={copy} />
      ) : null}
      {session?.state === "approved" && participantRole === "subject" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void act(session.paused ? "resume" : "pause")}
        >
          {session.paused ? copy.resumeSharing : copy.pauseSharing}
        </button>
      ) : null}
      {session?.paused ? <p role="status">{copy.paused}</p> : null}
      {session?.state === "approved" && !session.paused ? (
        <RelativeRoom key={id} id={id} participantRole={participantRole} copy={copy} />
      ) : null}
      {session && session.state !== "ended" ? (
        <button type="button" disabled={busy} onClick={() => void act("end")}>
          {copy.end}
        </button>
      ) : null}
      {session?.state === "ended" ? <p role="status">{copy.ended}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {copy.error}
        </p>
      ) : null}
    </div>
  );
}
