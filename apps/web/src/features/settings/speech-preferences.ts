"use client";

import {
  DEFAULT_PREFERENCES,
  type Preferences,
  preferencesSchema,
} from "@lotse/brain/preferences/schema";
import { useEffect, useState } from "react";
import { SETTINGS_CONFIG } from "@/config.ts";

export type SpeechPreferences = Pick<Preferences, "speechRate" | "voiceURI">;

export function useSpeechPreferences(): SpeechPreferences {
  return useWorkspacePreferences();
}

export function useWorkspacePreferences(): Preferences {
  const [preferences, setPreferences] = useState<Preferences>({ ...DEFAULT_PREFERENCES });
  useEffect(() => {
    const controller = new AbortController();
    // A save event takes precedence over an in-flight initial read.
    let updated = false;
    const receive = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return;
      const result = preferencesSchema.safeParse(event.detail);
      if (result.success) {
        updated = true;
        setPreferences(result.data);
      }
    };
    window.addEventListener(SETTINGS_CONFIG.preferencesEvent, receive);
    async function load(): Promise<void> {
      try {
        const response = await fetch(SETTINGS_CONFIG.preferencesUrl, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = preferencesSchema.parse(await response.json());
        if (!controller.signal.aborted && !updated) setPreferences(result);
      } catch {
        /* Speech keeps the system defaults when preferences cannot be read. */
      }
    }
    void load();
    return () => {
      controller.abort();
      window.removeEventListener(SETTINGS_CONFIG.preferencesEvent, receive);
    };
  }, []);
  return preferences;
}

export function applySpeechPreferences(
  utterance: SpeechSynthesisUtterance,
  preferences: SpeechPreferences,
  voices: readonly SpeechSynthesisVoice[],
): void {
  utterance.rate = preferences.speechRate;
  const language = utterance.lang.slice(0, 2).toLowerCase();
  const selected = voices.find(
    (voice) =>
      voice.voiceURI === preferences.voiceURI && voice.lang.toLowerCase().startsWith(language),
  );
  if (selected) utterance.voice = selected;
}
