import type { WorkspaceSnapshot } from "@lotse/brain/workspace/schema";
import type { JSX } from "react";
import { formViewerUrl } from "../form-viewer/config.ts";
import { type FormViewerLanguage, formViewerCopy } from "../form-viewer/copy.ts";
import styles from "./workspace.module.css";

export function FormLinks({
  forms,
  language,
}: {
  forms: WorkspaceSnapshot["forms"];
  language: FormViewerLanguage;
}): JSX.Element | null {
  const copy = formViewerCopy[language];
  return forms.length ? (
    <section aria-label={copy.forms}>
      <h2>{copy.forms}</h2>
      <ul className={styles.list}>
        {forms.map((form) => (
          <li key={form.id} className={styles.card}>
            <strong>{form.title}</strong> <a href={formViewerUrl(form.id)}>{copy.open}</a>
          </li>
        ))}
      </ul>
    </section>
  ) : null;
}
