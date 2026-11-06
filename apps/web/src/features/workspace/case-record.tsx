"use client";

import type { JSX } from "react";
import { CaseHandoff } from "./case-handoff.tsx";
import { CaseHistory } from "./case-history.tsx";
import styles from "./case-record.module.css";
import { type WorkspaceLanguage, workspaceCopy } from "./copy.ts";
import "@lotse/ui/styles.css";

/** Handoff (FR-K3) and the replayable case history (FR-K4) for the case page and journey view. */
export function CaseRecord({
  caseId,
  subjectName,
  language,
  refreshKey,
}: {
  caseId: string;
  subjectName?: string;
  language: WorkspaceLanguage;
  refreshKey?: number;
}): JSX.Element {
  const copy = workspaceCopy[language];
  return (
    <div className={styles.record} key={caseId}>
      <CaseHandoff
        caseId={caseId}
        copy={copy}
        language={language}
        {...(subjectName ? { subjectName } : {})}
      />
      <CaseHistory
        caseId={caseId}
        copy={copy}
        language={language}
        {...(refreshKey === undefined ? {} : { refreshKey })}
      />
    </div>
  );
}
