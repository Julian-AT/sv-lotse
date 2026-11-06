import { VoiceVocabularySchema } from "@lotse/knowledge/voice-vocabulary";
import { z } from "zod";

export const VoiceTokenRequestSchema = z.strictObject({
  type: z.enum(["realtime_scribe", "tts_websocket"]),
  language: z.enum(["de", "en"]).default("de"),
});

export type VoiceTokenRequest = z.infer<typeof VoiceTokenRequestSchema>;
export const VoiceTokenSchema = z.object({
  token: z.string().min(1),
  vocabulary: VoiceVocabularySchema,
  modelId: z.string().min(1).optional(),
  voiceId: z.string().min(1).optional(),
  expiresIn: z.number().positive(),
});

export type VoiceToken = z.infer<typeof VoiceTokenSchema>;
