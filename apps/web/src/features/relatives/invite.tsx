"use client";
import type { ShareScope } from "@lotse/brain/subjects";
import { type ReactElement, useEffect, useId, useState } from "react";
import { casesResponseSchema, inviteResponseSchema, relativeRequest } from "./api.ts";
import type { RelativesCopy } from "./copy.ts";
import styles from "./relatives.module.css";
import { inviteScope, ScopePicker } from "./scope.tsx";
import { RelativeSessionPanel } from "./session.tsx";
import { RelativeSessions } from "./sessions.tsx";

export function RelativeInvite({
  copy,
  title,
}: {
  copy: RelativesCopy;
  title?: string;
}): ReactElement {
  const id = useId();
  const [cases, setCases] = useState<{ id: string; subjectId: string; confirmedGoal: string }[]>(
    [],
  );
  const [caseId, setCaseId] = useState("");
  const [shareScope, setShareScope] = useState<ShareScope>(inviteScope("none"));
  const [invite, setInvite] = useState<{ id: string; token: string; expiresAt: string } | null>(
    null,
  );
  const [link, setLink] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      const result = await relativeRequest("/api/relatives/invites", inviteResponseSchema, {
        caseId,
        shareScope,
      });
      setInvite(result);
      // Keep the bearer invite out of request URLs, access logs and referrers.
      setLink(`${window.location.origin}/helper#${result.token}`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void relativeRequest(
      "/api/relatives/invites",
      casesResponseSchema,
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setCases(result.cases);
        setCaseId(result.cases[0]?.id ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError(true);
    }
  }
  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title ?? copy.title}</h2>
      <p className={styles.note}>{copy.scope}</p>
      {!invite ? (
        cases.length ? (
          <div className={styles.controls}>
            <label htmlFor={`${id}-case`}>{copy.caseLabel}</label>
            <select
              id={`${id}-case`}
              value={caseId}
              onChange={(event) => {
                setCaseId(event.target.value);
                setShareScope(inviteScope("none"));
              }}
            >
              {cases.map((item, index) => (
                <option value={item.id} key={item.id}>
                  {item.confirmedGoal || `${copy.caseOption} ${index + 1}`}
                </option>
              ))}
            </select>
            <ScopePicker
              key={caseId}
              caseId={caseId}
              subjectId={cases.find((item) => item.id === caseId)?.subjectId ?? ""}
              value={shareScope}
              onChange={setShareScope}
              disabled={busy}
              copy={copy}
            />
            <button type="button" disabled={busy || !caseId} onClick={() => void create()}>
              {copy.invite}
            </button>
          </div>
        ) : (
          <p>{copy.noCases}</p>
        )
      ) : (
        <>
          <label htmlFor={`${id}-link`}>{copy.link}</label>
          <input
            id={`${id}-link`}
            className={styles.link}
            value={link}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <div className={styles.controls}>
            <button type="button" onClick={() => void copyLink()}>
              {copied ? copy.copied : copy.copy}
            </button>
            <span>
              {copy.expires}:{" "}
              <time dateTime={invite.expiresAt}>
                {new Date(invite.expiresAt).toLocaleTimeString()}
              </time>
            </span>
          </div>
          <RelativeSessionPanel id={invite.id} participantRole="subject" copy={copy} />
        </>
      )}
      <RelativeSessions caseId={caseId} {...(invite ? { excludeId: invite.id } : {})} copy={copy} />
      {error ? (
        <p className={styles.error} role="alert">
          {copy.error}
        </p>
      ) : null}
    </section>
  );
}
