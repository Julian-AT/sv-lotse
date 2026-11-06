import type { WorkspaceSnapshot } from "@lotse/brain/workspace/schema";
import { DocumentChecklist, en } from "@lotse/ui";
import type { JSX } from "react";
import { DocumentDropZone, DocumentUpload, useDocumentImport } from "@/conversation/upload.tsx";
import { useGuidance } from "@/speech/provider.tsx";
import { viewerCopy } from "../viewer/copy.ts";
import type { WorkspaceCopy, WorkspaceLanguage } from "./copy.ts";
import styles from "./workspace.module.css";

export function WorkspaceDocuments({
  snapshot,
  copy,
  language,
  onBenefit,
  onImported,
}: {
  snapshot: WorkspaceSnapshot;
  copy: WorkspaceCopy;
  language: WorkspaceLanguage;
  onBenefit: (id: string) => void;
  onImported: () => void;
}): JSX.Element {
  const guidance = useGuidance();
  const importer = useDocumentImport({
    subjectId: snapshot.currentCase?.subjectId,
    onUploaded: onImported,
  });
  const items = snapshot.checklist.map((item) => ({
    ...item,
    source: {
      id: item.id,
      title: copy.source,
      quote: item.source.quote,
      url: item.source.url,
      asOf: item.source.retrieved_at.slice(0, 10),
    },
  }));
  return (
    <DocumentDropZone importer={importer} className={styles.documents}>
      <div className={styles.field}>
        <label htmlFor="benefit">{copy.benefit}</label>
        <select
          id="benefit"
          value={snapshot.selectedBenefitId ?? ""}
          onChange={(event) => onBenefit(event.target.value)}
        >
          <option value="">{copy.selectBenefit}</option>
          {snapshot.benefits.map((benefit) => (
            <option key={benefit.id} value={benefit.id}>
              {benefit.title}
            </option>
          ))}
        </select>
      </div>
      <p className={styles.muted}>{copy.chooseBenefit}</p>
      {snapshot.selectedBenefitId ? (
        snapshot.checklist.length ? (
          <div className={styles.checklist}>
            <DocumentChecklist items={items} labels={language === "en" ? en : {}} />
            <p className={styles.muted}>{copy.documentMatching}</p>
            {snapshot.checklist.map((item) => (
              <details className={styles.source} key={item.id}>
                <summary>
                  {copy.source}: {item.title}
                </summary>
                <blockquote>{item.source.quote}</blockquote>
                <p>
                  {copy.retrieved}{" "}
                  <time dateTime={item.source.retrieved_at}>
                    {item.source.retrieved_at.slice(0, 10)}
                  </time>
                </p>
              </details>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>{copy.noRequirements}</p>
        )
      ) : null}
      <section aria-labelledby="stored-documents">
        <h2 id="stored-documents">{copy.storedDocuments}</h2>
        <DocumentUpload importer={importer} />
        {snapshot.documents.length ? (
          <ul className={styles.list}>
            {snapshot.documents.map((document) => (
              <li key={document.id} className={styles.card}>
                <strong>{document.type}</strong>
                <p>{copy.ocr[document.ocrStatus]}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (snapshot.currentCase)
                      guidance.openDocument({
                        documentId: document.id,
                        caseId: snapshot.currentCase.id,
                      });
                  }}
                >
                  {viewerCopy[language].open}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>{copy.noDocuments}</p>
        )}
      </section>
    </DocumentDropZone>
  );
}
