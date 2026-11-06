import type { Metadata } from "next";
import type { JSX } from "react";
import { relativesCopy } from "@/features/relatives/copy.ts";
import { RelativeInvite } from "@/features/relatives/invite.tsx";
import { workspacePreferences } from "@/server/preferences.ts";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/** The Mac app opens this view to create helper invites and approve joining helpers. */
export default async function WorkspaceHelpersPage(): Promise<JSX.Element> {
  const { language } = await workspacePreferences();
  return (
    <section style={{ maxWidth: "48rem", margin: "0 auto", padding: "1.5rem 1rem" }}>
      <p>
        <a href="/workspace">{language === "en" ? "Back to the chat" : "Zurück zum Chat"}</a>
      </p>
      <RelativeInvite copy={relativesCopy[language]} />
    </section>
  );
}
