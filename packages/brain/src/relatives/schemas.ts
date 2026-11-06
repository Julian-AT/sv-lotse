import { z } from "zod";
import { shareScopeSchema } from "../subjects/schemas.ts";

export const relativeIdentitySchema = z.strictObject({ userId: z.uuid(), sessionId: z.uuid() });
export type RelativeIdentity = z.infer<typeof relativeIdentitySchema>;
export const relativeSessionSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  caseShared: z.boolean(),
  paused: z.boolean(),
  ownerSessionId: z.uuid(),
  helperSessionId: z.uuid().nullable(),
  state: z.enum(["invited", "pending", "approved", "ended"]),
  expiresAt: z.coerce.date(),
});
export type RelativeSession = z.infer<typeof relativeSessionSchema>;
export const createInviteSchema = z.strictObject({
  caseId: z.uuid(),
  shareScope: shareScopeSchema.default({ mode: "restricted", case: false, factTypes: [] }),
});
export const joinInviteSchema = z.strictObject({ token: z.string().regex(/^[0-9a-f]{64}$/) });
export const sessionActionSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(["approve", "pause", "resume", "end"]),
});
export const sessionIdSchema = z.strictObject({ id: z.uuid() });

export class RelativeSessionError extends Error {
  constructor(public readonly code: "FORBIDDEN" | "INVITE_UNAVAILABLE" | "SESSION_NOT_APPROVED") {
    super(code);
    this.name = "RelativeSessionError";
  }
}
