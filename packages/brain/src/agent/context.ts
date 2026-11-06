import { z } from "zod";
export const runtimeContextSchema = z.object({
  caseId: z.uuid(),
  subjectId: z.uuid(),
  actorId: z.uuid(),
  userId: z.uuid(),
  sessionId: z.uuid(),
  actorRole: z.enum(["subject", "helper"]),
  autonomyLevel: z.enum(["L1", "L2", "L3"]),
  shareScope: z.record(z.string(), z.json()),
  sentenceIndex: z.int().nonnegative(),
});
export type RuntimeContext = z.infer<typeof runtimeContextSchema>;
