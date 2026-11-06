import type { Database } from "@lotse/db";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { z } from "zod";
import {
  RELATIVES_ROOM_PREFIX,
  RELATIVES_TOKEN_TTL_SECONDS,
  type RelativesConfiguration,
  relativesConfigurationSchema,
} from "./config.ts";

export { relativesEnvironmentShape } from "./config.ts";

export const relativesTokenInput = z.strictObject({
  caseId: z.uuid(),
  consent: z.literal(true),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[^\p{Cc}]+$/u)
    .optional(),
});

export class RelativesError extends Error {
  constructor(public readonly code: "RELATIVES_FORBIDDEN" | "RELATIVES_UNAVAILABLE") {
    super(code);
    this.name = "RelativesError";
  }
}

export type RelativesToken = {
  serverUrl: string;
  participantToken: string;
  expiresAt: string;
};

export type RelativeMember = {
  role: "subject" | "helper";
  userId: string;
  sessionId: string;
  displayName?: string;
};

/** Token identity, room and track grants always come from authenticated, persisted membership. */
export async function mintRelativesToken(
  config: RelativesConfiguration,
  member: RelativeMember,
  caseId: string,
  now = new Date(),
): Promise<RelativesToken> {
  const helper = member.role === "helper";
  const token = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, {
    identity: `${helper ? "helper" : "subject"}:${member.sessionId}`,
    ...(member.displayName ? { name: member.displayName } : {}),
    ttl: RELATIVES_TOKEN_TTL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: `${RELATIVES_ROOM_PREFIX}${caseId}`,
    canPublish: true,
    canPublishSources: helper
      ? [TrackSource.MICROPHONE]
      : [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE],
    canPublishData: helper,
    canSubscribe: true,
    canUpdateOwnMetadata: false,
    roomAdmin: false,
    roomCreate: false,
    roomRecord: false,
    recorder: false,
  });
  return {
    serverUrl: config.LIVEKIT_URL,
    participantToken: await token.toJwt(),
    expiresAt: new Date(now.getTime() + RELATIVES_TOKEN_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function createRelativesToken(
  database: Database,
  environment: Record<string, unknown>,
  identity: { userId: string; sessionId: string },
  input: z.infer<typeof relativesTokenInput>,
): Promise<RelativesToken> {
  const config = relativesConfigurationSchema.safeParse(environment);
  if (!config.success) throw new RelativesError("RELATIVES_UNAVAILABLE");
  const value = relativesTokenInput.parse(input);
  // Case owners may be helper actors for a dependent subject; ownership still authorizes publishing.
  const [row] = await database.sql`
    SELECT CASE WHEN s.created_by = ${identity.userId} OR a.role = 'subject'
      THEN 'subject' ELSE 'helper' END AS role
    FROM "case" c JOIN subject s ON s.id = c.subject_id
    LEFT JOIN case_actor a ON a.case_id = c.id AND a.user_id = ${identity.userId}
    WHERE c.id = ${value.caseId} AND (s.created_by = ${identity.userId} OR a.id IS NOT NULL)`;
  const member = z.object({ role: z.enum(["subject", "helper"]) }).safeParse(row);
  if (!member.success) throw new RelativesError("RELATIVES_FORBIDDEN");
  return mintRelativesToken(
    config.data,
    {
      ...identity,
      role: member.data.role,
      ...(value.displayName ? { displayName: value.displayName } : {}),
    },
    value.caseId,
  );
}

export { RELATIVE_TOKEN_TTL_SECONDS } from "./config.ts";
export type { RelativeIdentity, RelativeSession } from "./schemas.ts";
export {
  createInviteSchema,
  joinInviteSchema,
  RelativeSessionError,
  sessionActionSchema,
  sessionIdSchema,
} from "./schemas.ts";
export { createRelativeService } from "./service.ts";
