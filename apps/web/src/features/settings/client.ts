import {
  type Preferences,
  type PreferencesPatch,
  preferencesSchema,
} from "@lotse/brain/preferences/schema";
import { setAnalyticsConsent } from "@/analytics/client.ts";
import { SETTINGS_CONFIG } from "@/config.ts";

export class SettingsSaveError extends Error {
  constructor(readonly busy: boolean) {
    super("SETTINGS_SAVE_FAILED");
  }
}
export async function savePreferences(patch: PreferencesPatch): Promise<Preferences> {
  if (patch.analyticsConsent === false) setAnalyticsConsent(false);
  const response = await fetch(SETTINGS_CONFIG.preferencesUrl, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new SettingsSaveError(response.status === 409);
  const preferences = preferencesSchema.parse(await response.json());
  setAnalyticsConsent(preferences.analyticsConsent);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.cursorSize = String(preferences.cursorSize);
    document.documentElement.dataset.cursorSpeed = String(preferences.cursorSpeed);
    document.documentElement.dataset.reducedMotion = String(preferences.reducedMotion);
    document.documentElement.dataset.highContrast = String(preferences.highContrast);
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(SETTINGS_CONFIG.preferencesEvent, { detail: preferences }),
    );
  return preferences;
}
