import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import {
  LANGUAGE_CLASSIFIER_MAX_OUTPUT_TOKENS,
  LANGUAGE_CLASSIFIER_TIMEOUT_MS,
} from "../config/index.ts";
import { LANGUAGE_CLASSIFICATION_POLICY } from "./copy.ts";
import type { ProfileSettings, ProfileSettingsPatch } from "./settings.ts";

export const LanguageDetectionSchema = z.strictObject({
  detectedLanguage: z.enum(["de", "en", "unsupported"]).nullable(),
  requestedLanguage: z.enum(["de", "en"]).nullable(),
  simpleLanguage: z.boolean().nullable(),
  register: z.enum(["formal", "informal"]).nullable(),
  detailLevel: z.enum(["brief", "standard", "detailed"]).nullable(),
});
export type LanguageDetection = z.infer<typeof LanguageDetectionSchema>;

export async function detectCommunicationPreferences(
  text: string,
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<LanguageDetection> {
  const result = await generateText({
    model,
    system: LANGUAGE_CLASSIFICATION_POLICY,
    prompt: JSON.stringify({ utterance: text }),
    output: Output.object({ schema: LanguageDetectionSchema }),
    maxOutputTokens: LANGUAGE_CLASSIFIER_MAX_OUTPUT_TOKENS,
    timeout: LANGUAGE_CLASSIFIER_TIMEOUT_MS,
    maxRetries: 0,
    ...(abortSignal ? { abortSignal } : {}),
    telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false },
  });
  return LanguageDetectionSchema.parse(result.output);
}

function replyLanguage(detection: LanguageDetection): "de" | "en" | null {
  if (detection.requestedLanguage) return detection.requestedLanguage;
  return detection.detectedLanguage === "de" || detection.detectedLanguage === "en"
    ? detection.detectedLanguage
    : null;
}

/** Remember the reply language; other settings require an explicit request. */
export function preferencePatch(detection: LanguageDetection): ProfileSettingsPatch | undefined {
  const language = replyLanguage(detection);
  const patch: ProfileSettingsPatch = {
    ...(language === null ? {} : { language }),
    ...(detection.simpleLanguage === null ? {} : { simpleLanguage: detection.simpleLanguage }),
    ...(detection.register === null ? {} : { register: detection.register }),
    ...(detection.detailLevel === null ? {} : { detailLevel: detection.detailLevel }),
  };
  return Object.keys(patch).length ? patch : undefined;
}

export function replySettings(
  profile: ProfileSettings,
  detection: LanguageDetection,
): ProfileSettings {
  return {
    language: replyLanguage(detection) ?? profile.language,
    simpleLanguage: detection.simpleLanguage ?? profile.simpleLanguage,
    register: detection.register ?? profile.register,
    detailLevel: detection.detailLevel ?? profile.detailLevel,
  };
}
