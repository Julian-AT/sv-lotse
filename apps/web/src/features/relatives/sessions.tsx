"use client";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { browserSessionSchema, relativeRequest } from "./api.ts";
import { RELATIVE_POLL_MS } from "./config.ts";
import type { RelativesCopy } from "./copy.ts";
import { RelativeSessionPanel } from "./session.tsx";

const sessionsSchema = z.object({ sessions: z.array(browserSessionSchema) });
export function RelativeSessions({
  caseId,
  excludeId,
  copy,
}: {
  caseId: string;
  excludeId?: string;
  copy: RelativesCopy;
}): ReactElement {
  const [sessions, setSessions] = useState<z.infer<typeof sessionsSchema>["sessions"]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!caseId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll(): Promise<void> {
      try {
        const result = await relativeRequest(
          `/api/relatives/sessions?caseId=${encodeURIComponent(caseId)}`,
          sessionsSchema,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setSessions(result.sessions);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSessions([]);
          setFailed(true);
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), RELATIVE_POLL_MS);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [caseId]);
  return (
    <div>
      {sessions
        .filter((session) => session.id !== excludeId && session.state !== "ended")
        .map((session) => (
          <RelativeSessionPanel
            key={session.id}
            id={session.id}
            participantRole="subject"
            copy={copy}
          />
        ))}
      {failed && <p role="alert">{copy.error}</p>}
    </div>
  );
}
