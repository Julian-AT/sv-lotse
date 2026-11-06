import type { JSX } from "react";
import { settingsCopy } from "@/features/settings/copy.ts";
import { PrintGuide } from "@/features/settings/print-guide.tsx";
import styles from "@/features/shell/shell.module.css";
import { workspacePreferences } from "@/server/preferences.ts";

export default async function SetupGuidePage(): Promise<JSX.Element> {
  const preferences = await workspacePreferences();
  const copy = settingsCopy[preferences.language];
  return (
    <article className={styles.guide}>
      <h1>{copy.guideTitle}</h1>
      <PrintGuide label={copy.guide} />
      <ol>
        {copy.guideSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p>{copy.permissionHelp}</p>
      <p>{copy.autonomyHelp}</p>
    </article>
  );
}
