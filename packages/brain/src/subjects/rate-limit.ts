import type { Database } from "@lotse/db";
import { z } from "zod";
import {
  HELPER_APPROVAL_ATTEMPTS_PER_WINDOW,
  RATE_WINDOW_MS,
  TURN_REQUESTS_PER_WINDOW,
} from "./config.ts";

export class SessionRateLimitError extends Error {
  readonly status = 429;
  readonly code = "SESSION_RATE_LIMITED";
  readonly retryAfterSeconds = Math.ceil(RATE_WINDOW_MS / 1000);
  constructor() {
    super("SESSION_RATE_LIMITED");
    this.name = "SessionRateLimitError";
  }
}
const rateInput = z.strictObject({
  userId: z.uuid(),
  sessionId: z.uuid(),
  caseId: z.uuid().optional(),
  approvalAttempt: z.boolean(),
});

export function isApprovalAttempt(message: unknown): boolean {
  const parsed = z.object({ parts: z.array(z.unknown()) }).safeParse(message);
  return (
    parsed.success &&
    parsed.data.parts.some(
      (part) =>
        z.object({ state: z.literal("approval-responded") }).safeParse(part).success ||
        z.object({ type: z.literal("tool-approval-response") }).safeParse(part).success,
    )
  );
}

/** Session row locking serializes counters across processes. Denial logs survive the rejection. */
export async function enforceTurnRateLimit(
  database: Database,
  input: z.infer<typeof rateInput>,
): Promise<void> {
  const value = rateInput.parse(input);
  const limited = await database.sql.begin(async (sql) => {
    const [session] = await sql`SELECT id FROM session WHERE id = ${value.sessionId}
      AND user_id = ${value.userId} AND expires_at > clock_timestamp() FOR UPDATE`;
    // An unknown session is rejected by requireSession and the brain, not by the rate limit.
    if (!session) return false;
    const [actor] = value.caseId
      ? await sql`SELECT id, role FROM case_actor
      WHERE case_id = ${value.caseId} AND user_id = ${value.userId}`
      : [];
    const helperAttempt = actor?.role === "helper" && value.approvalAttempt;
    const [counts] = await sql`SELECT
      count(*) FILTER (WHERE action = 'turn.requested')::int AS turns,
      count(*) FILTER (WHERE action = 'helper.approval_attempt')::int AS approvals
      FROM audit_event WHERE target->>'sessionId' = ${value.sessionId}
        AND occurred_at > clock_timestamp() - ${RATE_WINDOW_MS} * interval '1 millisecond'`;
    const denied =
      Number(counts?.turns) >= TURN_REQUESTS_PER_WINDOW ||
      (helperAttempt && Number(counts?.approvals) >= HELPER_APPROVAL_ATTEMPTS_PER_WINDOW);
    const target = JSON.stringify({
      sessionId: value.sessionId,
      ...(value.caseId ? { caseId: value.caseId } : {}),
    });
    await sql`INSERT INTO audit_event (actor_id, action, target)
      VALUES (${actor?.id ?? value.userId}, 'turn.requested', ${target}::jsonb)`;
    if (helperAttempt)
      await sql`INSERT INTO audit_event (actor_id, action, target)
      VALUES (${actor.id}, 'helper.approval_attempt', ${target}::jsonb)`;
    if (denied)
      await sql`INSERT INTO audit_event (actor_id, action, target)
      VALUES (${actor?.id ?? value.userId}, 'session.rate_limited', ${target}::jsonb)`;
    return denied;
  });
  if (limited) throw new SessionRateLimitError();
}
