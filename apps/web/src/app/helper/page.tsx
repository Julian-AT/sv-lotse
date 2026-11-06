import type { Metadata } from "next";
import { relativesCopy } from "@/features/relatives/copy.ts";
import { HelperView } from "@/features/relatives/helper.tsx";
import { workspacePreferences } from "@/server/preferences.ts";
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function HelperPage() {
  const { language } = await workspacePreferences();
  return <HelperView copy={relativesCopy[language]} />;
}
