"use client";

import { Button, en } from "@lotse/ui";
import { type JSX, useEffect, useId, useState } from "react";
import { formatDate } from "@/i18n/format.ts";
import styles from "./case-record.module.css";
import { type ActionSubject, loadCaseHistory, type TimelineItem } from "./case-record.ts";
import type { WorkspaceCopy, WorkspaceLanguage } from "./copy.ts";
import { journeyStepTitle } from "./journey-copy.ts";
import { type ReplayState, useCaseReplay } from "./use-case-replay.ts";

type Described = { title: string; detail?: string; failed?: boolean };

function toolTitle(tool: string, copy: WorkspaceCopy, language: WorkspaceLanguage): string {
  return copy.record.tools[tool] ?? journeyStepTitle(tool, language);
}

function actionTitle(
  subject: ActionSubject,
  copy: WorkspaceCopy,
  language: WorkspaceLanguage,
): string {
  if ("tool" in subject) return toolTitle(subject.tool, copy, language);
  if ("screen" in subject) return copy.record.screenAction;
  if ("event" in subject) return copy.event[subject.event];
  return copy.record.audit[subject.audit] ?? copy.record.auditFallback;
}

function entryText(
  item: TimelineItem,
  copy: WorkspaceCopy,
  language: WorkspaceLanguage,
): Described {
  const record = copy.record;
  switch (item.type) {
    case "proposal":
      return {
        title: toolTitle(item.tool, copy, language),
        detail: record.outcome[item.outcome],
        failed: item.outcome === "failed",
      };
    case "approval":
      return {
        title: toolTitle(item.tool, copy, language),
        detail:
          item.decision === "pending"
            ? record.decision.pending
            : `${record.decision[item.decision]} ${record.by} ${record.actor[item.actor]}`,
      };
    case "action":
      return {
        title: actionTitle(item.subject, copy, language),
        ...("tool" in item.subject || "screen" in item.subject
          ? { detail: item.failed ? record.outcome.failed : record.outcome.done }
          : {}),
        failed: item.failed,
      };
    case "message":
      return { title: record.role[item.role], detail: item.text };
  }
}

function TimelineEntry({
  item,
  copy,
  language,
  current = false,
}: {
  item: TimelineItem;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
  current?: boolean;
}): JSX.Element {
  const { title, detail, failed } = entryText(item, copy, language);
  return (
    <li aria-current={current ? "step" : undefined}>
      <time dateTime={item.at}>
        {formatDate(language, Date.parse(item.at), { dateStyle: "short", timeStyle: "short" })}
      </time>
      <div className={styles.entry}>
        <span className={styles.kind}>{copy.record.kind[item.type]}</span>
        <strong>{title}</strong>
        {detail && (
          <span
            className={
              item.type === "message" ? styles.text : failed ? styles.failed : styles.muted
            }
          >
            {detail}
          </span>
        )}
      </div>
    </li>
  );
}

function ReplayView({
  state,
  replay,
  copy,
  language,
}: {
  state: Extract<ReplayState, { status: "open" }>;
  replay: ReturnType<typeof useCaseReplay>;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
}): JSX.Element {
  const headingId = useId();
  const record = copy.record;
  const labels = language === "en" ? { labels: en } : {};
  const atEnd = state.index >= state.frames.length - 1;
  return (
    <section className={styles.replay} aria-labelledby={headingId}>
      <h3 id={headingId}>{record.replayTitle}</h3>
      <p className={styles.muted}>{record.replayNote}</p>
      {state.frames.length === 0 ? (
        <p>{record.replayEmpty}</p>
      ) : (
        <>
          <p role="status">
            {record.step} {state.index + 1} {record.of} {state.frames.length}
          </p>
          <ol className={styles.timeline}>
            {state.frames.slice(0, state.index + 1).map((item, index) => (
              <TimelineEntry
                key={item.id}
                item={item}
                copy={copy}
                language={language}
                current={index === state.index}
              />
            ))}
          </ol>
        </>
      )}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          disabled={state.index === 0}
          onClick={replay.previous}
          {...labels}
        >
          {record.previous}
        </Button>
        <Button
          variant="secondary"
          disabled={state.frames.length < 2}
          onClick={replay.toggle}
          {...labels}
        >
          {state.playing ? record.pause : atEnd ? record.play : record.resume}
        </Button>
        <Button variant="secondary" disabled={atEnd} onClick={replay.next} {...labels}>
          {record.next}
        </Button>
        <Button variant="ghost" onClick={replay.close} {...labels}>
          {record.close}
        </Button>
      </div>
    </section>
  );
}

/** FR-K4: the "Verlauf" panel lists proposals, approvals and actions and can replay them. */
export function CaseHistory({
  caseId,
  copy,
  language,
  refreshKey = 0,
}: {
  caseId: string;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
  refreshKey?: number;
}): JSX.Element {
  const headingId = useId();
  const record = copy.record;
  const labels = language === "en" ? { labels: en } : {};
  const [revision, setRevision] = useState(0);
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [error, setError] = useState(false);
  const replay = useCaseReplay(caseId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey and revision request a reload.
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    loadCaseHistory(caseId, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setItems(next);
      },
      () => {
        if (!controller.signal.aborted) setError(true);
      },
    );
    return () => controller.abort();
  }, [caseId, refreshKey, revision]);
  return (
    <section
      className={styles.panel}
      aria-labelledby={headingId}
      aria-busy={(!items && !error) || undefined}
    >
      <div className={styles.header}>
        <h2 id={headingId}>{copy.history}</h2>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            loading={replay.state.status === "loading"}
            onClick={() => void replay.open()}
            {...labels}
          >
            {record.play}
          </Button>
          <Button variant="ghost" onClick={() => setRevision((value) => value + 1)} {...labels}>
            {record.refresh}
          </Button>
        </div>
      </div>
      <p className={styles.muted}>{record.historyHelp}</p>
      {replay.state.status === "loading" && <p role="status">{record.replayLoading}</p>}
      {replay.state.status === "error" && <p role="alert">{record.replayError}</p>}
      {replay.state.status === "open" ? (
        <ReplayView state={replay.state} replay={replay} copy={copy} language={language} />
      ) : (
        <>
          {/* Background loads stay out of live regions so the journey's own notices remain the only ones. */}
          {error && <p className={styles.failed}>{record.historyError}</p>}
          {!items && !error && <p className={styles.muted}>{record.historyLoading}</p>}
          {items?.length === 0 && <p>{record.historyEmpty}</p>}
          {items && items.length > 0 && (
            <ol className={styles.timeline}>
              {items.map((item) => (
                <TimelineEntry key={item.id} item={item} copy={copy} language={language} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
