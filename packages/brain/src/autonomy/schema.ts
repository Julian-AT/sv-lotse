import { z } from "zod";

export const autonomyLevelSchema = z.enum(["L1", "L2", "L3"]);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

export const autonomyChangeSchema = z.strictObject({
  autonomyLevel: autonomyLevelSchema,
  confirmed: z.literal(true),
});

export const autonomyConfirmationMetadata = z.object({
  autonomyConfirmation: z.strictObject({
    level: autonomyLevelSchema,
    actorId: z.uuid(),
    sessionId: z.uuid(),
  }),
});

export class AutonomyError extends Error {
  constructor(readonly code: "INVALID_AUTONOMY" | "AUTONOMY_ACCESS_DENIED") {
    super(code);
    this.name = "AutonomyError";
  }
}
