"use client";

import { useRouter } from "next/navigation";
import { type JSX, useState } from "react";
import { WorkspaceAppointments } from "./appointments.tsx";
import { type WorkspaceLanguage, type WorkspaceMode, workspaceCopy } from "./copy.ts";
import { WorkspaceDocuments } from "./documents.tsx";
import { WorkspaceFacilities } from "./facilities.tsx";
import { FormLinks } from "./form-links.tsx";
import { CaseJourney, CaseList } from "./journey.tsx";
import { WorkspaceNavigation } from "./navigation.tsx";
import { useWorkspace } from "./use-workspace.ts";
import styles from "./workspace.module.css";
import "@lotse/ui/styles.css";

export function WorkspaceClient({
  mode,
  language,
  initialQuery,
  initialFacilityId,
}: {
  mode: WorkspaceMode;
  language: WorkspaceLanguage;
  initialQuery: { caseId?: string; benefitId?: string };
  initialFacilityId: string;
}): JSX.Element {
  const copy = workspaceCopy[language];
  const router = useRouter();
  const [revision, setRevision] = useState(0);
  const { snapshot, error } = useWorkspace(initialQuery, revision);
  const current = snapshot?.currentCase;
  const intro =
    mode === "journey"
      ? copy.journeyIntro
      : mode === "cases"
        ? copy.casesIntro
        : mode === "documents"
          ? copy.documentsIntro
          : mode === "offers"
            ? copy.offersIntro
            : copy.appointmentsIntro;
  function navigate(key: "caseId" | "benefitId", value: string): void {
    const query = new URLSearchParams({
      ...(current ? { caseId: current.id } : {}),
      ...(snapshot?.selectedBenefitId ? { benefitId: snapshot.selectedBenefitId } : {}),
    });
    if (value) query.set(key, value);
    else query.delete(key);
    if (key === "caseId") query.delete("benefitId");
    router.push(`/${mode}?${query}`);
  }
  return (
    <div className={styles.page}>
      <header>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy[mode]}</h1>
        <p className={styles.intro}>{intro}</p>
      </header>
      <WorkspaceNavigation
        language={language}
        mode={mode}
        {...((current?.id ?? initialQuery.caseId)
          ? { caseId: current?.id ?? initialQuery.caseId }
          : {})}
        {...((snapshot?.selectedBenefitId ?? initialQuery.benefitId)
          ? { benefitId: snapshot?.selectedBenefitId ?? initialQuery.benefitId }
          : {})}
      />
      {error && (
        <div role="alert" className={styles.notice}>
          <p>{snapshot ? copy.refreshError : copy.error}</p>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            {copy.retry}
          </button>
        </div>
      )}
      {!snapshot && !error && <p role="status">{copy.loading}</p>}
      {snapshot && (
        <>
          {mode !== "cases" && snapshot.cases.length > 0 && (
            <div className={styles.field}>
              <label htmlFor="current-case">{copy.selectCase}</label>
              <select
                id="current-case"
                value={current?.id ?? ""}
                onChange={(event) => navigate("caseId", event.target.value)}
              >
                {snapshot.cases.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} — {entry.subjectName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!current && mode !== "offers" && (
            <div className={styles.empty}>
              <p>{copy.noCases}</p>
              <a href="/">{copy.conversation}</a>
            </div>
          )}
          {mode === "cases" && <CaseList snapshot={snapshot} copy={copy} language={language} />}
          {current && mode === "journey" && (
            <CaseJourney
              snapshot={snapshot}
              copy={copy}
              language={language}
              revision={revision}
              onChange={() => setRevision((value) => value + 1)}
            />
          )}
          {current && mode === "documents" && (
            <WorkspaceDocuments
              snapshot={snapshot}
              copy={copy}
              language={language}
              onBenefit={(id) => navigate("benefitId", id)}
              onImported={() => setRevision((value) => value + 1)}
            />
          )}
          {current && (mode === "journey" || mode === "documents") && (
            <FormLinks forms={snapshot.forms} language={language} />
          )}
          {mode === "offers" && (
            <WorkspaceFacilities
              facilities={snapshot.facilities}
              {...(current ? { caseId: current.id } : {})}
              {...(snapshot.selectedBenefitId ? { benefitId: snapshot.selectedBenefitId } : {})}
              copy={copy}
            />
          )}
          {current && mode === "appointments" && (
            <WorkspaceAppointments
              key={current.id}
              facilities={snapshot.facilities}
              caseId={current.id}
              benefitId={snapshot.selectedBenefitId}
              initialFacilityId={initialFacilityId}
              language={language}
              copy={copy}
            />
          )}
        </>
      )}
    </div>
  );
}
