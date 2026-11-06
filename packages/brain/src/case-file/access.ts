import { caseActors, cases, subjects, turns } from "@lotse/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { TURN_LEASE_MS } from "../config/index.ts";
import { effectiveShareScope } from "../subjects/access.ts";
import { helperSessionAccess } from "../subjects/session-access.ts";
import { CaseFileError, type CaseTransaction } from "./schema.ts";

/** History contains prose without fact-level provenance. Restricted helpers fail closed. */
export function hasFullCaseScope(scope: Record<string, unknown>): boolean {
  const effective = effectiveShareScope(scope);
  return effective.case && effective.facts === true && effective.documents === true;
}

export async function requireIdleCase(tx: CaseTransaction, caseId: string): Promise<void> {
  const [running] = await tx
    .select({ id: turns.id })
    .from(turns)
    .where(
      and(
        eq(turns.caseId, caseId),
        eq(turns.status, "running"),
        gt(turns.createdAt, sql`clock_timestamp() - ${TURN_LEASE_MS} * interval '1 millisecond'`),
      ),
    )
    .limit(1);
  if (running) throw new CaseFileError("case_busy");
}

export async function authorizeCase(
  tx: CaseTransaction,
  caseId: string,
  userId: string,
  write = false,
  sessionId?: string,
): Promise<{ case: typeof cases.$inferSelect; subject: typeof subjects.$inferSelect }> {
  const [row] = await tx
    .select({ case: cases, subject: subjects, actor: caseActors })
    .from(cases)
    .innerJoin(subjects, eq(subjects.id, cases.subjectId))
    .leftJoin(caseActors, and(eq(caseActors.caseId, cases.id), eq(caseActors.userId, userId)))
    .where(eq(cases.id, caseId))
    .for("update", { of: cases });
  if (!row) throw new CaseFileError("access_denied");
  const owner = row.subject.createdBy === userId || row.actor?.role === "subject";
  if (!owner && (write || !row.actor || !hasFullCaseScope(row.actor.shareScope)))
    throw new CaseFileError("access_denied");
  if (!owner) {
    const access = await tx.execute(
      sql`SELECT 1 WHERE ${helperSessionAccess(caseId, userId, sessionId)}`,
    );
    if (!access.length) throw new CaseFileError("access_denied");
  }
  return row;
}
