import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DatabaseClient } from "./client.ts";
import { approvals } from "./schema/cases.ts";

const approvalConsumption = z.object({
  approvalId: z.string().min(1),
  actorId: z.uuid(),
  sessionId: z.uuid(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  hmac: z.string().min(1),
});

// Persistence primitive only. The approval service must verify the HMAC,
// canonical input and actor permissions before calling this conditional write.
export function consumeApproval(db: DatabaseClient, expected: z.infer<typeof approvalConsumption>) {
  const input = approvalConsumption.parse(expected);
  return db
    .update(approvals)
    .set({ consumedAt: sql`clock_timestamp()` })
    .where(
      and(
        eq(approvals.approvalId, input.approvalId),
        eq(approvals.actorId, input.actorId),
        eq(approvals.sessionId, input.sessionId),
        eq(approvals.inputHash, input.inputHash),
        eq(approvals.hmac, input.hmac),
        eq(approvals.decision, "approved"),
        isNull(approvals.consumedAt),
      ),
    )
    .returning({ id: approvals.id, consumedAt: approvals.consumedAt });
}
