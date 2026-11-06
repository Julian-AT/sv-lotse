import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import type { ReactNode } from "react";
import { AutonomySettings } from "../features/autonomy/settings.tsx";
import { settingsCopy } from "../features/settings/copy.ts";
import { brandCopy } from "../features/shell/brand.ts";
import { shellCopy } from "../features/shell/copy.ts";
import { Settings } from "../features/shell/settings.tsx";
import styles from "../features/shell/shell.module.css";
import { I18nProvider } from "../i18n/provider.tsx";
import { createI18n } from "../i18n/translator.ts";
import { isNativeAppRequest } from "../server/native-app.ts";
import { workspacePreferences } from "../server/preferences.ts";
import { LayoutGuidanceConversation } from "../speech/conversation.tsx";
import { GuidanceProvider } from "../speech/provider.tsx";
import "./globals.css";
import "./ai-elements.css";
import "@lotse/ui/styles.css";

export const metadata: Metadata = {
  title: "SV KI-Lotse",
  description: "Orientierung im österreichischen Sozialversicherungssystem",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, ...preferences } = await workspacePreferences();
  const { language } = preferences;
  // The Mac app's web view gets its transparent surfaces from the first paint, before hydration.
  const native = isNativeAppRequest((await headers()).get("user-agent"));
  const { t } = createI18n(locale);
  const copy = shellCopy[locale];
  return (
    <html
      suppressHydrationWarning
      lang={language === "en" ? "en" : "de-AT"}
      data-cursor-size={preferences.cursorSize}
      data-cursor-speed={preferences.cursorSpeed}
      data-reduced-motion={preferences.reducedMotion}
      data-high-contrast={preferences.highContrast}
      data-native-workspace={native ? "true" : undefined}
    >
      <body>
        <I18nProvider locale={locale}>
          <a className={styles.skipLink} href="#main">
            {copy.skip}
          </a>
          <header className={styles.siteHeader}>
            <span className={styles.wordmark}>
              <Image src="/brand/sv-logo.png" alt="" width={44} height={44} unoptimized />
              <span>{brandCopy[language].name}</span>
            </span>
            <nav aria-label={copy.navigation}>
              <a
                href="?lang=de"
                lang="de"
                hrefLang="de"
                aria-current={locale === "de" ? "page" : undefined}
              >
                {t("preferences.german")}
              </a>
              <a
                href="?lang=en"
                lang="en"
                hrefLang="en"
                aria-current={locale === "en" ? "page" : undefined}
              >
                {t("preferences.english")}
              </a>
              <a
                href="?lang=de-simple"
                lang="de"
                hrefLang="de"
                aria-current={locale === "de-simple" ? "page" : undefined}
              >
                {t("preferences.simpleGerman")}
              </a>
            </nav>
            <p className={styles.level}>
              {settingsCopy[language].currentLevel}: <strong>{preferences.autonomyLevel}</strong>
            </p>
            <Settings copy={copy} initial={preferences} />
            <AutonomySettings language={language} initialLevel={preferences.autonomyLevel} />
          </header>
          <main className={styles.main} id="main" tabIndex={-1}>
            <GuidanceProvider language={language}>
              {children}
              <LayoutGuidanceConversation language={language} />
            </GuidanceProvider>
          </main>
          <footer className={styles.footer}>
            <p>{copy.footer}</p>
          </footer>
        </I18nProvider>
      </body>
    </html>
  );
}
