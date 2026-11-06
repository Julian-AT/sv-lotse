import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { jobs } from "@lotse/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "../approvals/index.ts";
import { JOB_LEASE_MS, JOB_MAX_ATTEMPTS } from "../config/index.ts";
import { JobError, type JobState, jobStateSchema } from "./schema.ts";

export type JobRow = typeof jobs.$inferSelect;
export type JobClaim = { row: JobRow; state: JobState; leaseId: string };

/** SKIP LOCKED permits independent workers; the persisted token fences delayed writers. */
export async function claimJob(
  db: DatabaseClient,
): Promise<(JobClaim & { failed: false }) | { failed: true; row: JobRow } | undefined> {
  return db.transaction(async (tx) => {
    const now = Date.now();
    const [row] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "tool-bundle"),
          inArray(jobs.status, ["pending", "running"]),
          sql`case when jsonb_typeof(${jobs.stepState}->'leaseUntil') = 'number' then (${jobs.stepState}->>'leaseUntil')::numeric else 0 end <= ${now}`,
          sql`case when jsonb_typeof(${jobs.stepState}->'retryAt') = 'number' then (${jobs.stepState}->>'retryAt')::numeric else 0 end <= ${now}`,
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return undefined;
    const parsed = jobStateSchema.safeParse(row.stepState);
    const failures = parsed.success
      ? parsed.data.failures + (row.status === "running" ? 1 : 0)
      : JOB_MAX_ATTEMPTS;
    if (!parsed.success || failures >= JOB_MAX_ATTEMPTS) {
      await tx.update(jobs).set({ status: "failed" }).where(eq(jobs.id, row.id));
      return { failed: true as const, row: { ...row, status: "failed" as const } };
    }
    const leaseId = randomUUID();
    const state: JobState = {
      ...parsed.data,
      failures,
      leaseId,
      leaseUntil: now + JOB_LEASE_MS,
      error: null,
    };
    const [claimed] = await tx
      .update(jobs)
      .set({ status: "running", attempts: row.attempts + 1, stepState: state })
      .where(eq(jobs.id, row.id))
      .returning();
    return claimed ? { failed: false as const, row: claimed, state, leaseId } : undefined;
  });
}

export async function lockJobClaim(tx: Transaction, claim: JobClaim): Promise<void> {
  const [row] = await tx.select().from(jobs).where(eq(jobs.id, claim.row.id)).for("update");
  if (
    row?.status !== "running" ||
    row.stepState.leaseId !== claim.leaseId ||
    row.attempts !== claim.row.attempts
  )
    throw new JobError("JOB_LEASE_LOST", 409);
}

export async function saveJobClaim(
  db: DatabaseClient,
  claim: JobClaim,
  state: JobState,
  status: JobRow["status"],
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockJobClaim(tx, claim);
    await tx.update(jobs).set({ stepState: state, status }).where(eq(jobs.id, claim.row.id));
  });
}
