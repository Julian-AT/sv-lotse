import { createHash, randomBytes } from "node:crypto";
import type { Database } from "@lotse/db";
import { z } from "zod";
import { effectiveShareScope } from "../subjects/access.ts";
import { INVITE_TOKEN_BYTES } from "../subjects/config.ts";
import { createHelperSessionService, sessionDuration } from "../subjects/helper-sessions.ts";
import { insertActor, requireCaseAuthority } from "../subjects/persistence.ts";
import { type ShareScope, shareScopeSchema } from "../subjects/schemas.ts";
import {
  emitProductEvent,
  helperSessionEvent,
  type ProductEventSink,
} from "../telemetry/product-events.ts";
import { RELATIVE_INVITE_LIFETIME_MS, RELATIVE_SESSION_LIFETIME_MS } from "./config.ts";
import {
  type RelativeIdentity,
  type RelativeSession,
  RelativeSessionError,
  relativeIdentitySchema,
  relativeSessionSchema,
} from "./schemas.ts";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface RelativeRoomAccess {
  room: string;
  identity: string;
  role: "subject" | "helper";
  peerIdentity: string;
  expiresAt: Date;
}
export interface RelativeService {
  listSessions(caseId: string): Promise<RelativeSession[]>;
  getSession(id: string): Promise<RelativeSession>;
  listCases(): Promise<{ id: string; subjectId: string; confirmedGoal: string }[]>;
  createInvite(
    caseId: string,
    shareScope?: ShareScope,
  ): Promise<{ id: string; token: string; expiresAt: Date }>;
  joinInvite(token: string): Promise<RelativeSession>;
  control(id: string, action: "pause" | "resume"): Promise<RelativeSession>;
  approve(id: string): Promise<RelativeSession>;
  end(id: string): Promise<RelativeSession>;
  roomAccess(id: string): Promise<RelativeRoomAccess>;
}
export function createRelativeService(
  database: Database,
  identity: RelativeIdentity,
  options: { onProductEvent?: ProductEventSink } = {},
): RelativeService {
  const caller = relativeIdentitySchema.parse(identity);

  async function getSession(id: string): Promise<RelativeSession> {
    z.uuid().parse(id);
    const [row] = await database.sql`
      SELECT r.id, i.case_id AS "caseId", i.share_scope AS "shareScope",
        COALESCE(h.scope->>'status' = 'paused', false) AS paused, r.owner_session_id AS "ownerSessionId",
        r.helper_session_id AS "helperSessionId",
        CASE WHEN r.expires_at <= clock_timestamp()
          OR os.expires_at <= clock_timestamp()
          OR (r.state = 'approved' AND (hs.expires_at <= clock_timestamp()
            OR h.ended_at IS NOT NULL OR h.scope->>'status' = 'ended'))
          THEN 'ended' ELSE r.state END AS state,
        r.expires_at AS "expiresAt"
      FROM relative_session r JOIN helper_invite i ON i.id = r.invite_id
      JOIN session os ON os.id = r.owner_session_id
      LEFT JOIN session hs ON hs.id = r.helper_session_id
      LEFT JOIN helper_session h ON h.id = r.id
      WHERE r.id = ${id} AND (r.owner_session_id = ${caller.sessionId}
        OR r.helper_session_id = ${caller.sessionId})`;
    if (!row) throw new RelativeSessionError("FORBIDDEN");
    return relativeSessionSchema.parse({
      ...row,
      caseShared: !row.paused && effectiveShareScope(row.shareScope).case,
    });
  }

  return {
    getSession,
    async listSessions(caseId: string): Promise<RelativeSession[]> {
      z.uuid().parse(caseId);
      const ids = await database.sql.begin(async (sql) => {
        await requireCaseAuthority(sql, caseId, caller.userId);
        return sql`SELECT r.id FROM relative_session r JOIN helper_invite i ON i.id = r.invite_id
          WHERE i.case_id = ${caseId} AND r.owner_session_id = ${caller.sessionId}
          AND r.state <> 'ended' ORDER BY r.created_at DESC`;
      });
      return Promise.all(ids.map((row) => getSession(z.uuid().parse(row.id))));
    },
    async listCases(): Promise<{ id: string; subjectId: string; confirmedGoal: string }[]> {
      const rows = await database.sql`
        SELECT c.id, c.subject_id AS "subjectId", c.confirmed_goal AS "confirmedGoal" FROM "case" c JOIN subject s ON s.id = c.subject_id
        WHERE s.created_by = ${caller.userId} OR EXISTS (
          SELECT 1 FROM case_actor a WHERE a.case_id = c.id
            AND a.user_id = ${caller.userId} AND a.role = 'subject')
        ORDER BY c.created_at DESC`;
      return z
        .array(z.object({ id: z.uuid(), subjectId: z.uuid(), confirmedGoal: z.string() }))
        .parse(rows);
    },
    async createInvite(
      caseId: string,
      shareScope?: ShareScope,
    ): Promise<{ id: string; token: string; expiresAt: Date }> {
      z.uuid().parse(caseId);
      const scope = shareScopeSchema.parse(
        shareScope ?? { mode: "restricted", case: false, factTypes: [] },
      );
      const token = randomBytes(INVITE_TOKEN_BYTES).toString("hex");
      const id = await database.sql.begin(async (sql) => {
        await requireCaseAuthority(sql, caseId, caller.userId);
        const [invite] = await sql`
          INSERT INTO helper_invite (token_hash, case_id, issuer_id, share_scope, expires_at)
          VALUES (${hashToken(token)}, ${caseId}, ${caller.userId},
            ${JSON.stringify(scope)}::jsonb,
            clock_timestamp() + ${RELATIVE_INVITE_LIFETIME_MS} * interval '1 millisecond')
          RETURNING id, expires_at`;
        if (!invite) throw new RelativeSessionError("INVITE_UNAVAILABLE");
        const [session] = await sql`
          INSERT INTO relative_session (invite_id, owner_session_id, expires_at)
          VALUES (${invite.id}, ${caller.sessionId}, ${invite.expires_at}) RETURNING id`;
        if (!session) throw new RelativeSessionError("INVITE_UNAVAILABLE");
        return z.uuid().parse(session.id);
      });
      return { id, token, expiresAt: (await getSession(id)).expiresAt };
    },
    async joinInvite(token: string): Promise<RelativeSession> {
      if (!/^[0-9a-f]{64}$/.test(token)) throw new RelativeSessionError("INVITE_UNAVAILABLE");
      const id = await database.sql.begin(async (sql) => {
        const [row] = await sql`
          SELECT r.id, r.state, r.helper_session_id, i.issuer_id, i.consumed_at
          FROM relative_session r JOIN helper_invite i ON i.id = r.invite_id
          WHERE i.token_hash = ${hashToken(token)}
          FOR UPDATE OF r, i`;
        if (!row || row.issuer_id === caller.userId)
          throw new RelativeSessionError("INVITE_UNAVAILABLE");
        // A reload by the same browser is idempotent; another browser cannot steal the claim.
        if (row.helper_session_id === caller.sessionId) return z.uuid().parse(row.id);
        if (row.state !== "invited" || row.consumed_at)
          throw new RelativeSessionError("INVITE_UNAVAILABLE");
        const [updated] = await sql`
          UPDATE relative_session SET helper_session_id = ${caller.sessionId}, state = 'pending'
          WHERE id = ${row.id} AND expires_at > clock_timestamp() RETURNING invite_id`;
        if (!updated) throw new RelativeSessionError("INVITE_UNAVAILABLE");
        await sql`UPDATE helper_invite SET consumed_at = clock_timestamp() WHERE id = ${updated.invite_id}`;
        await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${caller.userId}, 'relatives.join_requested', ${JSON.stringify({ sessionId: row.id })}::jsonb)`;
        return z.uuid().parse(row.id);
      });
      return getSession(id);
    },
    async control(id: string, action: "pause" | "resume"): Promise<RelativeSession> {
      const session = await getSession(id);
      if (session.ownerSessionId !== caller.sessionId || session.state !== "approved")
        throw new RelativeSessionError("FORBIDDEN");
      await createHelperSessionService(
        database,
        caller.userId,
        caller.sessionId,
      ).controlHelperSession({ joinId: id, action });
      return getSession(id);
    },
    async approve(id: string): Promise<RelativeSession> {
      z.uuid().parse(id);
      const mode = await database.sql.begin(async (sql) => {
        const [row] = await sql`
          SELECT r.invite_id, i.case_id, i.share_scope, hs.id AS helper_session_id, hs.user_id AS helper_id,
            clock_timestamp() + ${RELATIVE_SESSION_LIFETIME_MS} * interval '1 millisecond' AS expires_at
          FROM relative_session r JOIN helper_invite i ON i.id = r.invite_id
          JOIN session hs ON hs.id = r.helper_session_id
          JOIN session os ON os.id = r.owner_session_id
          WHERE os.user_id = ${caller.userId} AND os.expires_at > clock_timestamp() AND r.id = ${id} AND r.owner_session_id = ${caller.sessionId}
            AND r.state = 'pending' AND r.expires_at > clock_timestamp()
            AND hs.expires_at > clock_timestamp() FOR UPDATE OF r`;
        if (!row) throw new RelativeSessionError("FORBIDDEN");
        await requireCaseAuthority(sql, z.uuid().parse(row.case_id), caller.userId);
        const shareScope = shareScopeSchema.parse(row.share_scope);
        const scope = {
          status: "active",
          issuerId: caller.userId,
          sessionId: z.uuid().parse(row.helper_session_id),
          expiresAt: z.coerce.date().parse(row.expires_at).toISOString(),
          shareScope,
        };
        if (effectiveShareScope(shareScope).case)
          await insertActor(sql, {
            caseId: z.uuid().parse(row.case_id),
            userId: z.uuid().parse(row.helper_id),
            role: "helper",
            shareScope,
          });
        await sql`INSERT INTO helper_session (id, case_id, helper_id, scope)
          VALUES (${id}, ${row.case_id}, ${row.helper_id}, ${JSON.stringify(scope)}::jsonb)`;
        await sql`UPDATE relative_session SET state = 'approved',
          expires_at = ${row.expires_at}
          WHERE id = ${id}`;
        await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${caller.userId}, 'relatives.join_approved', ${JSON.stringify({ sessionId: id })}::jsonb)`;
        return shareScope.mode;
      });
      emitProductEvent(options.onProductEvent, helperSessionEvent("helper_session_started", mode));
      return getSession(id);
    },
    async end(id: string): Promise<RelativeSession> {
      const before = await getSession(id);
      const timing = await database.sql.begin(async (sql) => {
        await sql`UPDATE relative_session SET state = 'ended' WHERE id = ${id}`;
        await sql`DELETE FROM case_actor
          WHERE role = 'helper' AND (case_id, user_id) IN (
            SELECT case_id, helper_id FROM helper_session WHERE id = ${id} AND ended_at IS NULL)`;
        const [row] =
          await sql`UPDATE helper_session SET ended_at = COALESCE(ended_at, clock_timestamp()),
          scope = jsonb_set(scope, '{status}', '"ended"') WHERE id = ${id}
          RETURNING started_at AS "startedAt", ended_at AS "endedAt", scope->'shareScope'->>'mode' AS "mode"`;
        await sql`INSERT INTO audit_event (actor_id, action, target)
          VALUES (${caller.userId}, 'relatives.ended', ${JSON.stringify({ sessionId: id })}::jsonb)`;
        return row;
      });
      if (before.state === "approved" && timing)
        emitProductEvent(
          options.onProductEvent,
          helperSessionEvent(
            "helper_session_ended",
            timing.mode === "full" || timing.mode === "restricted" ? timing.mode : "screen",
            sessionDuration(timing),
          ),
        );
      return getSession(id);
    },
    async roomAccess(id: string): Promise<RelativeRoomAccess> {
      const session = await getSession(id);
      if (session.state !== "approved" || session.paused)
        throw new RelativeSessionError("SESSION_NOT_APPROVED");
      // Recheck both browser sessions and the case authority on every token issuance.
      await database.sql.begin(async (sql) => {
        const [active] = await sql`SELECT os.user_id FROM session os JOIN session hs
          ON hs.id = ${session.helperSessionId} WHERE os.id = ${session.ownerSessionId}
          AND os.expires_at > clock_timestamp() AND hs.expires_at > clock_timestamp()`;
        if (!active) throw new RelativeSessionError("FORBIDDEN");
        await requireCaseAuthority(sql, session.caseId, z.uuid().parse(active.user_id));
      });
      const role = session.ownerSessionId === caller.sessionId ? "subject" : "helper";
      return {
        room: `relative-${id}`,
        identity: `${role}-${caller.sessionId}`,
        role,
        peerIdentity:
          role === "subject"
            ? `helper-${session.helperSessionId}`
            : `subject-${session.ownerSessionId}`,
        expiresAt: session.expiresAt,
      };
    },
  };
}
