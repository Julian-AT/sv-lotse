import type { Preferences } from "./schema.ts";

type ResponsePreferences = Pick<
  Preferences,
  "language" | "simpleLanguage" | "register" | "detailLevel"
>;
const languageInstructions = { de: "Reply in German.", en: "Reply in English." } as const;
const registerInstructions = {
  formal: "Use formal address (Sie in German).",
  informal: "Use informal address (du in German).",
} as const;
const detailInstructions = {
  brief: "Keep answers brief.",
  standard: "Give a concise answer with the necessary explanation.",
  detailed: "Give a detailed explanation of the administrative steps.",
} as const;
export function responsePreferenceInstructions(preferences?: ResponsePreferences): string {
  if (!preferences) return "";
  return [
    languageInstructions[preferences.language],
    registerInstructions[preferences.register],
    detailInstructions[preferences.detailLevel],
    preferences.simpleLanguage
      ? "Use simple language at about CEFR B1: short sentences, everyday words, one instruction at a time. Ask the user to say when a step is done."
      : "",
    "A direct request to change language or response style applies to the current answer. These preferences do not change safety rules or tool permissions. Official form content stays in German; provide translated explanations separately.",
  ]
    .filter(Boolean)
    .join(" ");
}
