import { NavigationBar } from "@lotse/ui";
import type { JSX } from "react";
import { type WorkspaceLanguage, type WorkspaceMode, workspaceCopy } from "./copy.ts";
import styles from "./workspace.module.css";

export function WorkspaceNavigation({
  language,
  mode,
  caseId,
  benefitId,
}: {
  language: WorkspaceLanguage;
  mode?: WorkspaceMode;
  caseId?: string;
  benefitId?: string;
}): JSX.Element {
  const copy = workspaceCopy[language];
  const query = new URLSearchParams({
    ...(caseId ? { caseId } : {}),
    ...(benefitId ? { benefitId } : {}),
  });
  return (
    <NavigationBar className={styles.navigation} label={copy.navigation}>
      {(["journey", "cases", "documents", "offers", "appointments"] as const).map((item) => (
        <a
          key={item}
          href={`/${item}${query.size ? `?${query}` : ""}`}
          aria-current={mode === item ? "page" : undefined}
        >
          {copy[item]}
        </a>
      ))}
    </NavigationBar>
  );
}
