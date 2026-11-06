import { type SQL, sql } from "drizzle-orm";

/** A managed grant belongs to one live browser session. Unmanaged actors remain supported. */
export function helperSessionAccess(caseId: string | SQL, userId: string, sessionId?: string): SQL {
  return sql`(NOT EXISTS (
    SELECT 1 FROM helper_session h WHERE h.case_id = ${caseId} AND h.helper_id = ${userId}
  ) OR EXISTS (
    SELECT 1 FROM helper_session h
    JOIN session s ON s.id::text = h.scope->>'sessionId'
    WHERE h.case_id = ${caseId} AND h.helper_id = ${userId}
      AND h.ended_at IS NULL AND h.scope->>'status' = 'active'
      AND s.user_id = ${userId} AND s.expires_at > clock_timestamp()
      AND NULLIF(h.scope->>'expiresAt', '')::timestamptz > clock_timestamp()
      ${sessionId ? sql`AND s.id = ${sessionId}` : sql``}
      AND (NOT EXISTS (SELECT 1 FROM relative_session r WHERE r.id = h.id) OR EXISTS (
        SELECT 1 FROM relative_session r JOIN session os ON os.id = r.owner_session_id
        WHERE r.id = h.id AND r.state = 'approved' AND r.expires_at > clock_timestamp()
          AND os.expires_at > clock_timestamp()
      ))
  ))`;
}
