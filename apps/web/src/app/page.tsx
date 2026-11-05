import { Link } from "@lotse/ui";
import { NativeWorkspaceEntry } from "../bridge/native-entry.tsx";
import { guidedPortalCopy } from "../features/guided-portal/copy.ts";
import { relativesCopy } from "../features/relatives/copy.ts";
import { RelativeInvite } from "../features/relatives/invite.tsx";
import { Onboarding } from "../features/settings/onboarding.tsx";
import { shellCopy } from "../features/shell/copy.ts";
import styles from "../features/shell/shell.module.css";
import { WorkspaceNavigation } from "../features/workspace/navigation.tsx";
import { createI18n } from "../i18n/translator.ts";
import { workspacePreferences } from "../server/preferences.ts";
import { VoiceWorkspace } from "../voice/workspace.tsx";

export default async function HomePage() {
  const { locale, ...preferences } = await workspacePreferences();
  const copy = shellCopy[locale];
  return (
    <>
      <section className={styles.welcome} aria-labelledby="welcome-title">
        <div className={styles.welcomeIntro}>
          <NativeWorkspaceEntry />
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1 id="welcome-title" tabIndex={-1}>
            {copy.title}
          </h1>
          <p className={styles.introduction}>{copy.introduction}</p>
          <div className={styles.sessionNote}>
            <p>{copy.privacy}</p>
          </div>
          <p className={styles.boundary}>{copy.boundary}</p>
        </div>
        <div className={styles.welcomeTools}>
          <WorkspaceNavigation language={preferences.language} />
          <VoiceWorkspace language={preferences.language} />
          <p className={styles.welcomeLinks}>
            <a href="/guided">{guidedPortalCopy[preferences.language].link}</a>
            <Link href="/workspace">{createI18n(locale).t("workspace.title")}</Link>
          </p>
          <RelativeInvite copy={relativesCopy[preferences.language]} />
        </div>
      </section>
      {!preferences.onboardingCompleted && <Onboarding initial={preferences} />}
    </>
  );
}
