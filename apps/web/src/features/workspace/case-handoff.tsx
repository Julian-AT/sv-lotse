"use client";

import { Button, en } from "@lotse/ui";
import { type JSX, useEffect, useId, useRef, useState } from "react";
import styles from "./case-record.module.css";
import {
  CaseRecordError,
  handoffFileName,
  loadSubjectName,
  prepareHandoff,
} from "./case-record.ts";
import type { WorkspaceCopy, WorkspaceLanguage } from "./copy.ts";

type HandoffState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "ready"; url: string; fileName: string }
  | { status: "error"; busy: boolean };

/** FR-K3: one action composes the case summary and offers it as a named PDF download. */
export function CaseHandoff({
  caseId,
  subjectName,
  copy,
  language,
}: {
  caseId: string;
  subjectName?: string;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
}): JSX.Element {
  const headingId = useId();
  const [state, setState] = useState<HandoffState>({ status: "idle" });
  const objectUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );
  async function prepare(): Promise<void> {
    setState({ status: "pending" });
    try {
      const [pdf, name] = await Promise.all([
        prepareHandoff(caseId),
        subjectName ?? loadSubjectName(caseId).catch(() => null),
      ]);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      const url = URL.createObjectURL(pdf);
      objectUrl.current = url;
      setState({ status: "ready", url, fileName: handoffFileName(copy.record.handoffFile, name) });
    } catch (error) {
      setState({
        status: "error",
        busy: error instanceof CaseRecordError && error.code === "CASE_BUSY",
      });
    }
  }
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId}>{copy.record.handoffTitle}</h2>
      <p>{copy.record.handoffHelp}</p>
      <div className={styles.actions}>
        <Button
          loading={state.status === "pending"}
          onClick={() => void prepare()}
          {...(language === "en" ? { labels: en } : {})}
        >
          {copy.record.handoff}
        </Button>
        {state.status === "ready" && (
          <a
            className={`lotse-button ${styles.download}`}
            data-variant="secondary"
            href={state.url}
            download={state.fileName}
          >
            {copy.record.handoffDownload}
          </a>
        )}
      </div>
      {state.status === "pending" && <p role="status">{copy.record.handoffPending}</p>}
      {state.status === "ready" && (
        <p role="status">{`${copy.record.handoffReady} ${state.fileName}`}</p>
      )}
      {state.status === "error" && (
        <p role="alert">{state.busy ? copy.record.handoffBusy : copy.record.handoffError}</p>
      )}
    </section>
  );
}
