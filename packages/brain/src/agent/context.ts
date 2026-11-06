import { z } from "zod";
import { ProfileSettingsSchema } from "../language/settings.ts";
import { preferencesSchema } from "../preferences/schema.ts";

export const runtimeContextSchema = z.object({
  caseId: z.uuid(),
  subjectId: z.uuid(),
  actorId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.uuid(),
  actorRole: z.enum(["subject", "helper"]),
  autonomyLevel: z.enum(["L1", "L2", "L3"]),
  shareScope: z.record(z.string(), z.json()),
  responsePreferences: preferencesSchema
    .pick({ language: true, simpleLanguage: true, register: true, detailLevel: true })
    .optional(),
  sentenceIndex: z.int().nonnegative(),
  profileSettings: ProfileSettingsSchema.optional(),
});

export type RuntimeContext = z.infer<typeof runtimeContextSchema>;
