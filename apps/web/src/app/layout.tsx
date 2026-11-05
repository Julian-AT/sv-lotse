import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { shellCopy } from "../features/shell/copy.ts";
import { Settings } from "../features/shell/settings.tsx";
import styles from "../features/shell/shell.module.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SV KI-Lotse",
  description: "Orientierung im österreichischen Sozialversicherungssystem",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = (await cookies()).get("lotse_language")?.value === "en" ? "en" : "de";
  const copy = shellCopy[language];
  return (
    <html lang={language === "de" ? "de-AT" : "en"}>
      <body>
        <a className={styles.skipLink} href="#main">
          {copy.skip}
        </a>
        <header className={styles.siteHeader}>
          <a className={styles.wordmark} href="/">
            SV KI-Lotse
          </a>
          <nav aria-label={copy.navigation}>
            <a
              href="/?lang=de"
              lang="de"
              hrefLang="de"
              aria-current={language === "de" ? "page" : undefined}
            >
              Deutsch
            </a>
            <a
              href="/?lang=en"
              lang="en"
              hrefLang="en"
              aria-current={language === "en" ? "page" : undefined}
            >
              English
            </a>
          </nav>
          <Settings copy={copy} />
        </header>
        <main className={styles.main} id="main" tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.footer}>
          <p>{copy.footer}</p>
        </footer>
      </body>
    </html>
  );
}
