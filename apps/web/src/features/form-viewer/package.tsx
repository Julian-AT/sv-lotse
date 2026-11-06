"use client";

import { type JSX, useState } from "react";
import { z } from "zod";
import { formExportUrl, formPackageUrl } from "./config.ts";
import { type FormViewerLanguage, formViewerCopy } from "./copy.ts";
import styles from "./viewer.module.css";

const PackageContent = z.object({
  attachmentChecklist: z.array(z.string()),
  coverLetter: z.string(),
  pdfUrl: z.string(),
});

export function FormPackage(props: {
  formInstanceId: string;
  language: FormViewerLanguage;
  blocked: boolean;
}): JSX.Element {
  const copy = formViewerCopy[props.language];
  const [result, setResult] = useState<z.infer<typeof PackageContent>>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const create = async (): Promise<void> => {
    setPending(true);
    setError(false);
    setResult(undefined);
    try {
      const response = await fetch(formPackageUrl(props.formInstanceId), {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("FORM_PACKAGE_FAILED");
      const content = PackageContent.parse(await response.json());
      if (content.pdfUrl !== formExportUrl(props.formInstanceId))
        throw new Error("FORM_PACKAGE_FAILED");
      setResult(content);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <section className={styles.package} aria-label={copy.packageTitle} aria-busy={pending}>
      <h2>{copy.packageTitle}</h2>
      <p>{copy.packageNotice}</p>
      <button type="button" disabled={pending || props.blocked} onClick={() => void create()}>
        {pending ? copy.creatingPackage : copy.createPackage}
      </button>
      {error && <p role="alert">{copy.packageError}</p>}
      {result && (
        <div>
          <h3>{copy.packageChecklist}</h3>
          {result.attachmentChecklist.length ? (
            <ul>
              {result.attachmentChecklist.map((attachment) => (
                <li key={attachment}>
                  <label>
                    <input type="checkbox" />
                    {attachment}
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.packageNoAttachments}</p>
          )}
          <h3>{copy.packageLetter}</h3>
          <p className={styles.coverLetter}>{result.coverLetter}</p>
          <a href={result.pdfUrl} download="lotse-form.pdf">
            {copy.packageDownload}
          </a>
        </div>
      )}
    </section>
  );
}
