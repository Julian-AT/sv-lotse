import { createPreferencesService } from "@lotse/brain/preferences";
import type { Preferences } from "@lotse/brain/preferences/schema";
import { headers } from "next/headers";
import { cache } from "react";
import type { Locale } from "../i18n/config.ts";
import { resolveLocale } from "../i18n/locale.ts";
import { getEnvironment } from "./env.ts";
import { getDatabase } from "./resources.ts";
import { requireSession } from "./session.ts";

/** Shared by layout and page, so one request has one authenticated locale. */
export const workspacePreferences = cache(async (): Promise<Preferences & { locale: Locale }> => {
  const requestHeaders = await headers();
  const request = new Request(getEnvironment().LOTSE_WORKSPACE_URL, { headers: requestHeaders });
  const session = await requireSession(request);
  const preferences = await createPreferencesService(getDatabase().db, session.userId).read();
  return {
    ...preferences,
    locale: resolveLocale({
      profilePreference:
        preferences.language === "de" && preferences.simpleLanguage
          ? "de-simple"
          : preferences.language,
      acceptLanguage: requestHeaders.get("accept-language"),
    }),
  };
});
