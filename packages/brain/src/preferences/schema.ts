import { z } from "zod";

export const presentationPreferencesSchema = z.strictObject({
  simpleLanguage: z.boolean(),
  analyticsConsent: z.boolean(),
  onboardingCompleted: z.boolean(),
  reducedMotion: z.boolean(),
  highContrast: z.boolean(),
  speechRate: z.number().min(0.5).max(1.5),
  cursorSize: z.number().min(16).max(64),
  cursorSpeed: z.number().min(0.5).max(2),
  voiceURI: z.string().max(256),
});
export const preferencesSchema = presentationPreferencesSchema.extend({
  language: z.enum(["de", "en"]),
  register: z.enum(["formal", "informal"]),
  detailLevel: z.enum(["brief", "standard", "detailed"]),
  autonomyLevel: z.enum(["L1", "L2", "L3"]),
});
export const preferencesPatchSchema = preferencesSchema.partial();
export type Preferences = z.infer<typeof preferencesSchema>;
export type PreferencesPatch = z.infer<typeof preferencesPatchSchema>;
export const DEFAULT_PREFERENCES: Readonly<Preferences> = {
  language: "de",
  register: "formal",
  detailLevel: "standard",
  autonomyLevel: "L3",
  simpleLanguage: false,
  analyticsConsent: false,
  onboardingCompleted: false,
  reducedMotion: false,
  highContrast: false,
  speechRate: 1,
  cursorSize: 24,
  cursorSpeed: 1,
  voiceURI: "",
};

export function profilePreferences(
  profile?: {
    language: string;
    register: string;
    detailLevel: string;
    autonomyLevel: string;
    preferences: unknown;
  } | null,
): Preferences {
  if (!profile) return { ...DEFAULT_PREFERENCES };
  const language = profile.language.toLowerCase();
  const presentation = presentationPreferencesSchema.partial().safeParse(profile.preferences);
  return preferencesSchema.parse({
    ...DEFAULT_PREFERENCES,
    ...(presentation.success ? presentation.data : {}),
    language: language === "en" || language.startsWith("en-") ? "en" : "de",
    simpleLanguage:
      (presentation.success ? presentation.data.simpleLanguage : undefined) ??
      language.endsWith("-simple"),
    register: profile.register,
    detailLevel: profile.detailLevel,
    autonomyLevel: profile.autonomyLevel,
  });
}
