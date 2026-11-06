import type { DatabaseClient } from "@lotse/db";
import { approvals, auditEvents, jobs, turns } from "@lotse/db/schema";
import { DATA_PARTS } from "@lotse/protocol";
import { validateUIMessages } from "ai";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { TURN_LEASE_MS } from "../config/index.ts";
import { type JobProgressPart, jobProgress } from "../jobs/progress.ts";
import type { LotseMessage } from "../tools/types.ts";
import { TurnError } from "./errors.ts";
import { loadMessages, saveMessages } from "./history.ts";
import { recoverConsumedCalls } from "./recovery.ts";
import { resolveContext, type SessionIdentity } from "./store.ts";

export type CaseConversationSnapshot = {
  caseId: string;
  subjectId: string;
  messages: LotseMessage[];
  jobs: JobProgressPart[];
};

/** Explicit resume transfers only unconsumed approvals to the same authorized actor. */
export async function loadCaseConversation(
  db: DatabaseClient,
  caseId: string,
  identity: SessionIdentity,
  resume = false,
): Promise<CaseConversationSnapshot> {
  if (!z.uuid().safeParse(caseId).success) throw new TurnError("INVALID_TURN", 400);
  return db.transaction(async (tx) => {
    const context = await resolveContext(
      tx,
      { caseId, inputKind: "text", capsule: {}, actionResults: [] },
      identity,
    );
    if (context.actorRole === "helper" && context.shareScope.facts !== true)
      throw new TurnError("CASE_ACCESS_DENIED", 403);
    let history = await loadMessages(tx, caseId);
    if (resume) {
      const running = await tx
        .select()
        .from(turns)
        .where(and(eq(turns.caseId, caseId), eq(turns.status, "running")));
      if (running.some((turn) => turn.createdAt.getTime() > Date.now() - TURN_LEASE_MS))
        throw new TurnError("TURN_IN_PROGRESS", 409);
      await tx
        .update(turns)
        .set({ status: "interrupted" })
        .where(and(eq(turns.caseId, caseId), eq(turns.status, "running")));
      history = await recoverConsumedCalls(tx, caseId, history);
      await saveMessages(tx, caseId, history);
      if (context.actorRole === "subject") {
        const transferred = await tx
          .update(approvals)
          .set({ sessionId: identity.sessionId })
          .where(
            and(
              eq(approvals.caseId, caseId),
              eq(approvals.actorId, context.actorId),
              eq(approvals.decision, "pending"),
              isNull(approvals.consumedAt),
            ),
          )
          .returning({ approvalId: approvals.approvalId });
        if (transferred.length > 0)
          await tx.insert(auditEvents).values({
            actorId: context.actorId,
            action: "conversation.resumed",
            target: { caseId, sessionId: identity.sessionId },
          });
      }
    }
    const caseJobs = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.caseId, caseId))
      .orderBy(jobs.createdAt, jobs.id);
    return {
      caseId,
      subjectId: context.subjectId,
      messages:
        history.length === 0
          ? []
          : await validateUIMessages<LotseMessage>({
              messages: history,
              dataSchemas: DATA_PARTS,
            }),
      jobs: caseJobs.map((job) => ({
        type: "data-job-progress" as const,
        id: job.id,
        data: jobProgress(job),
      })),
    };
  });
}
