import { z } from "zod";

export const serviceIdSchema = z.enum([
  "brain",
  "database",
  "storage",
  "openai",
  "elevenlabs",
  "livekit",
]);
export type ServiceId = z.infer<typeof serviceIdSchema>;
export const connectionSchema = z.strictObject({
  id: serviceIdSchema,
  status: z.enum(["verified", "missing"]),
  reason: z.enum(["ok", "not_configured", "unreachable"]),
  /** ElevenLabs only: the voice ids actually used per language (configured or account fallback). */
  activeVoices: z
    .strictObject({
      de: z.strictObject({ voiceId: z.string(), source: z.enum(["configured", "fallback"]) }),
      en: z.strictObject({ voiceId: z.string(), source: z.enum(["configured", "fallback"]) }),
    })
    .optional(),
});
export type Connection = z.infer<typeof connectionSchema>;
export const healthDetailsSchema = z.strictObject({
  checkedAt: z.iso.datetime(),
  connections: z.array(connectionSchema).length(serviceIdSchema.options.length),
});
export type HealthDetails = z.infer<typeof healthDetailsSchema>;
