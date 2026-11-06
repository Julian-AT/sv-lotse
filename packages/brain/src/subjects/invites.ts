import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@lotse/db";
import { z } from "zod";
import { INVITE_TOKEN_BYTES } from "./config.ts";
import {
  insertActor,
  requireCaseAuthority,
  SubjectServiceError,
  subjectOperation,
} from "./persistence.ts";
import { type CaseActor, shareScopeSchema } from "./schemas.ts";

const inviteInput = z.strictObject({
  caseId: z.uuid(),
  shareScope: shareScopeSchema,
  expiresAt: z.date(),
});
const inviteRow = inviteInput.extend({ issuerId: z.uuid(), expiresAt: z.coerce.date() });
const tokenInput = z.string().regex(/^[0-9a-f]{64}$/);

export interface HelperInviteService {
  inviteHelper(input: z.infer<typeof inviteInput>): Promise<{ token: string; expiresAt: Date }>;
  acceptHelperInvite(token: string): Promise<CaseActor>;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createHelperInviteService(database: Database, userId: string): HelperInviteService {
  return {
    inviteHelper: (input) =>
      subjectOperation(async () => {
        const value = inviteInput.parse(input);
        const token = randomBytes(INVITE_TOKEN_BYTES).toString("hex");
        return database.sql.begin(async (sql) => {
          await requireCaseAuthority(sql, value.caseId, userId);
          const [row] = await sql`
          INSERT INTO helper_invite (token_hash, case_id, issuer_id, share_scope, expires_at)
          SELECT ${hashToken(token)}, ${value.caseId}, ${userId},
            ${JSON.stringify(value.shareScope)}::jsonb, ${value.expiresAt.toISOString()}::timestamptz
          WHERE ${value.expiresAt.toISOString()}::timestamptz > clock_timestamp()
          RETURNING expires_at AS "expiresAt"`;
          if (!row) throw new SubjectServiceError("invalid_expiry");
          return { token, expiresAt: z.coerce.date().parse(row.expiresAt) };
        });
      }),

    acceptHelperInvite: (token) =>
      subjectOperation(async () => {
        if (!tokenInput.safeParse(token).success) throw new SubjectServiceError("invalid_invite");
        return database.sql.begin(async (sql) => {
          // Acquire the row lock before checking the clock: lock waits must not extend validity.
          await sql`SELECT id FROM helper_invite WHERE token_hash = ${hashToken(token)} FOR UPDATE`;
          // The conditional UPDATE is the linearization point for concurrent claimants.
          // Actor insertion shares its transaction, so a failed join never burns the token.
          const [row] = await sql`
          UPDATE helper_invite SET consumed_at = clock_timestamp()
          WHERE token_hash = ${hashToken(token)} AND consumed_at IS NULL
            AND expires_at > clock_timestamp()
          RETURNING case_id AS "caseId", issuer_id AS "issuerId",
            share_scope AS "shareScope", expires_at AS "expiresAt"`;
          if (!row) throw new SubjectServiceError("invalid_invite");
          const invite = inviteRow.parse(row);
          await requireCaseAuthority(sql, invite.caseId, invite.issuerId);
          return insertActor(sql, {
            caseId: invite.caseId,
            userId,
            role: "helper",
            shareScope: invite.shareScope,
          });
        });
      }),
  };
}
