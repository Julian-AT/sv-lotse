"use client";

import type { WorkspaceSnapshot } from "@lotse/brain/workspace/schema";
import { en, JourneyMap } from "@lotse/ui";
import { type JSX, useState } from "react";
import { CaseRecord } from "./case-record.tsx";
import { type WorkspaceCopy, type WorkspaceLanguage, workspaceCopy } from "./copy.ts";
import { journeyActionsCopy } from "./journey-actions-copy.ts";
import { journeyStepTitle } from "./journey-copy.ts";
import { RemindersPanel } from "./reminders.tsx";
import { StepActions } from "./step-actions.tsx";
import { useWorkspace } from "./use-workspace.ts";
import styles from "./workspace.module.css";

export function CaseJourney({
  snapshot,
  copy,
  language,
  onChange,
  revision = 0,
}: {
  snapshot: WorkspaceSnapshot;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
  onChange?: () => void;
  revision?: number;
}): JSX.Element {
  const actions = journeyActionsCopy[language];
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [completed, setCompleted] = useState(false);
  async function complete(stepId: string): Promise<void> {
    if (pending || !snapshot.currentCase) return;
    setPending(stepId);
    setFailed(false);
    setCompleted(false);
    try {
      const response = await fetch(
        `/api/cases/${snapshot.currentCase.id}/steps/${stepId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) throw new Error("STEP_COMPLETION_FAILED");
      setCompleted(true);
      onChange?.();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }
  return (
    <div className={styles.journey}>
      {failed && <p role="alert">{actions.completionError}</p>}
      {completed && <p role="status">{actions.completed}</p>}
      {snapshot.steps.length ? (
        <JourneyMap
          steps={snapshot.steps.map(({ dueDate, ...step }) => ({
            ...step,
            title: journeyStepTitle(step.title, language),
            ...(dueDate ? { dueDate } : {}),
          }))}
          labels={language === "en" ? en : {}}
          renderStepDetails={(entry) => {
            const step = snapshot.steps.find((item) => item.id === entry.id);
            if (!step) return null;
            return (
              <>
                {step.initiatedBy === "pilot" && step.status !== "completed" && (
                  <p>{actions.prepared}</p>
                )}
                {step.artifacts?.length ? (
                  <details>
                    <summary>{actions.artifacts}</summary>
                    {step.artifacts.map((artifact) => (
                      <div key={artifact.id}>
                        <pre style={{ whiteSpace: "pre-wrap" }}>{artifact.text}</pre>
                        {artifact.sources.map((source) => (
                          <p key={source.url + source.quote}>
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {copy.source}
                            </a>
                            <q>{source.quote}</q>
                          </p>
                        ))}
                      </div>
                    ))}
                  </details>
                ) : null}
                {step.status !== "completed" && !step.blocked && (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => {
                      void complete(step.id);
                    }}
                  >
                    {pending === step.id ? actions.completing : actions.complete}
                  </button>
                )}
              </>
            );
          }}
        />
      ) : (
        <p className={styles.empty}>{copy.noSteps}</p>
      )}
      {snapshot.steps
        .filter((step) => step.blocked)
        .map((step) => (
          <p key={step.id} className={styles.notice}>
            {copy.blocked} {journeyStepTitle(step.title, language)}
          </p>
        ))}
      {snapshot.currentCase && (
        <>
          <RemindersPanel
            caseId={snapshot.currentCase.id}
            language={language}
            revision={revision}
          />
          <section aria-label={copy.stepActions}>
            {snapshot.steps.map((step) => (
              <div key={step.id} className={styles.card}>
                <p>{journeyStepTitle(step.title, language)}</p>
                <StepActions
                  caseId={snapshot.currentCase?.id ?? ""}
                  step={step}
                  copy={copy}
                  onChanged={() => onChange?.()}
                />
              </div>
            ))}
            <a href={`/cases/${snapshot.currentCase.id}`}>{copy.continueCase}</a>
          </section>
          <CaseRecord
            caseId={snapshot.currentCase.id}
            subjectName={snapshot.currentCase.subjectName}
            language={language}
            refreshKey={snapshot.events.length + revision}
          />
        </>
      )}
    </div>
  );
}

export function CaseList({
  snapshot,
  copy,
  language,
}: {
  snapshot: WorkspaceSnapshot;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
}): JSX.Element {
  return (
    <ul className={`${styles.list} ${styles.grid}`}>
      {snapshot.cases.map((entry) => (
        <li key={entry.id} className={styles.card}>
          <span className={styles.badge}>{copy.status[entry.status]}</span>
          <h2>{entry.title}</h2>
          <p>
            {copy.forPerson} {entry.subjectName}
          </p>
          <p className={styles.muted}>
            {copy.created}{" "}
            <time dateTime={entry.createdAt}>
              {new Date(entry.createdAt).toLocaleDateString(language === "de" ? "de-AT" : "en-GB")}
            </time>
          </p>
          <a href={`/journey?caseId=${encodeURIComponent(entry.id)}`}>{copy.openCase}</a>
          <a href={`/cases/${encodeURIComponent(entry.id)}`}>{copy.continueCase}</a>
        </li>
      ))}
    </ul>
  );
}

export function CaseProgress({
  caseId,
  language,
}: {
  caseId: string;
  language: WorkspaceLanguage;
}): JSX.Element {
  const [revision, setRevision] = useState(0);
  const { snapshot, error } = useWorkspace({ caseId }, revision);
  const copy = workspaceCopy[language];
  if (!snapshot)
    return <p role={error ? "alert" : "status"}>{error ? copy.error : copy.loading}</p>;
  return (
    <CaseJourney
      snapshot={snapshot}
      copy={copy}
      language={language}
      revision={revision}
      onChange={() => setRevision((value) => value + 1)}
    />
  );
}
