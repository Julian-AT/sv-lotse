import type { Database } from "@lotse/db";
import { z } from "zod";
import {
  emitProductEvent,
  helperSessionEvent,
  type ProductEventSink,
} from "../telemetry/product-events.ts";
import { hashInviteToken } from "./invites.ts";
import {
  insertActor,
  requireCaseAuthority,
  SubjectServiceError,
  subjectOperation,
} from "./persistence.ts";
import { type CaseActor, type ShareScope, shareScopeSchema } from "./schemas.ts";

const sessionTiming = z.object({ startedAt: z.coerce.date(), endedAt: z.coerce.date() });
/** Milliseconds between start and end; unreadable timing reports zero rather than failing. */
export function sessionDuration(raw: unknown): number {
  const timing = sessionTiming.safeParse(raw);
  return timing.success ? timing.data.endedAt.getTime() - timing.data.startedAt.getTime() : 0;
}

const joinScope = z.strictObject({
  status: z.enum(["pending", "active", "paused", "ended"]),
  issuerId: z.uuid(),
  sessionId: z.uuid(),
  expiresAt: z.iso.datetime(),
  shareScope: shareScopeSchema,
});
const joinRow = z.object({ id: z.uuid(), caseId: z.uuid(), helperId: z.uuid(), scope: joinScope });
export interface HelperJoin {
  id: string;
  caseId: string;
  helperId: string;
  status: "pending" | "active" | "paused" | "ended";
  shareScope: ShareScope;
}
export interface HelperSessionService {
  getHelperJoin(joinId: string): Promise<HelperJoin>;
  requestHelperJoin(token: string, sessionId: string): Promise<HelperJoin>;
  approveHelperJoin(joinId: string): Promise<CaseActor>;
  listHelperSessions(caseId: string): Promise<HelperJoin[]>;
  controlHelperSession(input: {
    joinId: string;
    action: "pause" | "resume" | "end";
  }): Promise<void>;
}

/** Joining only queues a request. It grants no case actor or access until owner approval. */
export function createHelperSessionService(
  database: Pick<Database, "sql">,
  userId: string,
  sessionId?: string,
  analytics?: ProductEventSink,
): HelperSessionService {
  return {
    getHelperJoin: (joinId) =>
      subjectOperation(async () => {
        z.uuid().parse(joinId);
        return database.sql.begin(async (sql) => {
          const [row] = await sql`SELECT id, case_id AS "caseId", helper_id AS "helperId", scope
          FROM helper_session WHERE id = ${joinId} FOR SHARE`;
          if (!row) throw new SubjectServiceError("forbidden");
          const join = joinRow.parse(row);
          if (join.helperId !== userId) await requireCaseAuthority(sql, join.caseId, userId);
          else if (sessionId && join.scope.sessionId !== sessionId)
            throw new SubjectServiceError("forbidden");
          return {
            id: join.id,
            caseId: join.caseId,
            helperId: join.helperId,
            status: join.scope.status,
            shareScope: join.scope.shareScope,
          };
        });
      }),
    requestHelperJoin: (token, sessionId) =>
      subjectOperation(async () => {
        if (
          !z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .safeParse(token).success
        )
          throw new SubjectServiceError("invalid_invite");
        z.uuid().parse(sessionId);
        return database.sql.begin(async (sql) => {
          const [session] = await sql`SELECT id FROM session WHERE id = ${sessionId}
          AND user_id = ${userId} AND expires_at > clock_timestamp() FOR UPDATE`;
          if (!session) throw new SubjectServiceError("forbidden");
          await sql`SELECT id FROM helper_invite WHERE token_hash = ${hashInviteToken(token)} FOR UPDATE`;
          const [invite] = await sql`UPDATE helper_invite SET consumed_at = clock_timestamp()
          WHERE token_hash = ${hashInviteToken(token)} AND consumed_at IS NULL AND expires_at > clock_timestamp()
          RETURNING case_id, issuer_id, share_scope, expires_at`;
          if (!invite) throw new SubjectServiceError("invalid_invite");
          await requireCaseAuthority(sql, invite.case_id, invite.issuer_id);
          const [existing] =
            await sql`SELECT id FROM case_actor WHERE case_id = ${invite.case_id} AND user_id = ${userId}`;
          if (existing) throw new SubjectServiceError("actor_exists");
          const scope = joinScope.parse({
            status: "pending",
            issuerId: invite.issuer_id,
            sessionId,
            expiresAt: z.coerce.date().parse(invite.expires_at).toISOString(),
            shareScope: invite.share_scope,
          });
          const [row] = await sql`INSERT INTO helper_session (case_id, helper_id, scope)
          VALUES (${invite.case_id}, ${userId}, ${JSON.stringify(scope)}::jsonb)
          RETURNING id, case_id AS "caseId", helper_id AS "helperId", scope`;
          const join = joinRow.parse(row);
          await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${userId}, 'helper.join_requested', ${JSON.stringify({ joinId: join.id, caseId: join.caseId })}::jsonb)`;
          return {
            id: join.id,
            caseId: join.caseId,
            helperId: join.helperId,
            status: scope.status,
            shareScope: scope.shareScope,
          };
        });
      }),
    approveHelperJoin: (joinId) =>
      subjectOperation(async () => {
        z.uuid().parse(joinId);
        const actor = await database.sql.begin(async (sql) => {
          const [row] = await sql`SELECT id, case_id AS "caseId", helper_id AS "helperId", scope
          FROM helper_session WHERE id = ${joinId} AND ended_at IS NULL FOR UPDATE`;
          if (!row) throw new SubjectServiceError("forbidden");
          const join = joinRow.parse(row);
          await requireCaseAuthority(sql, join.caseId, userId);
          await requireCaseAuthority(sql, join.caseId, join.scope.issuerId);
          const [valid] = await sql`SELECT id FROM session WHERE id = ${join.scope.sessionId}
          AND user_id = ${join.helperId} AND expires_at > clock_timestamp()
          AND ${join.scope.expiresAt}::timestamptz > clock_timestamp() FOR SHARE`;
          if (!valid || join.scope.status !== "pending")
            throw new SubjectServiceError("invalid_invite");
          const actor = await insertActor(sql, {
            caseId: join.caseId,
            userId: join.helperId,
            role: "helper",
            shareScope: join.scope.shareScope,
          });
          await sql`UPDATE helper_session SET scope = ${JSON.stringify({ ...join.scope, status: "active" })}::jsonb
          WHERE id = ${joinId}`;
          await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${userId}, 'helper.join_approved', ${JSON.stringify({ joinId, caseId: join.caseId })}::jsonb)`;
          return actor;
        });
        // Analytics runs after commit and must never fail the approval itself.
        const scope = shareScopeSchema.safeParse(actor.shareScope);
        emitProductEvent(
          analytics,
          helperSessionEvent(
            "helper_session_started",
            scope.success ? scope.data.mode : "restricted",
          ),
        );
        return actor;
      }),
    listHelperSessions: (caseId) =>
      subjectOperation(async () => {
        z.uuid().parse(caseId);
        return database.sql.begin(async (sql) => {
          await requireCaseAuthority(sql, caseId, userId);
          const rows = await sql`SELECT id, case_id AS "caseId", helper_id AS "helperId", scope
          FROM helper_session WHERE case_id = ${caseId} AND ended_at IS NULL ORDER BY started_at, id`;
          return z
            .array(joinRow)
            .parse(rows)
            .map((join) => ({
              id: join.id,
              caseId: join.caseId,
              helperId: join.helperId,
              status: join.scope.status,
              shareScope: join.scope.shareScope,
            }));
        });
      }),
    controlHelperSession: (input) =>
      subjectOperation(async () => {
        const { joinId, action } = z
          .strictObject({ joinId: z.uuid(), action: z.enum(["pause", "resume", "end"]) })
          .parse(input);
        const ended = await database.sql.begin(async (sql) => {
          const [row] = await sql`SELECT id, case_id AS "caseId", helper_id AS "helperId", scope
          FROM helper_session WHERE id = ${joinId} AND ended_at IS NULL FOR UPDATE`;
          if (!row) throw new SubjectServiceError("forbidden");
          const join = joinRow.parse(row);
          if (userId !== join.helperId || action !== "end")
            await requireCaseAuthority(sql, join.caseId, userId);
          if (action !== "end" && !["active", "paused"].includes(join.scope.status))
            throw new SubjectServiceError("forbidden");
          if (action === "end" && join.scope.status !== "pending") {
            await sql`DELETE FROM case_actor WHERE case_id = ${join.caseId} AND user_id = ${join.helperId} AND role = 'helper'`;
          } else if (action !== "end") {
            const scope =
              action === "resume"
                ? join.scope.shareScope
                : { mode: "restricted", case: false, factTypes: [] };
            await sql`UPDATE case_actor SET share_scope = ${JSON.stringify(scope)}::jsonb
            WHERE case_id = ${join.caseId} AND user_id = ${join.helperId} AND role = 'helper'`;
          }
          const status = action === "end" ? "ended" : action === "pause" ? "paused" : "active";
          const [timing] =
            await sql`UPDATE helper_session SET scope = ${JSON.stringify({ ...join.scope, status })}::jsonb,
          ended_at = CASE WHEN ${action} = 'end' THEN clock_timestamp() ELSE NULL END WHERE id = ${joinId}
          RETURNING started_at AS "startedAt", ended_at AS "endedAt"`;
          await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${userId}, ${`helper.${status}`}, ${JSON.stringify({ joinId, caseId: join.caseId })}::jsonb)`;
          return action === "end" && join.scope.status !== "pending"
            ? { mode: join.scope.shareScope.mode, timing }
            : undefined;
        });
        if (ended)
          emitProductEvent(
            analytics,
            helperSessionEvent("helper_session_ended", ended.mode, sessionDuration(ended.timing)),
          );
      }),
  };
}
