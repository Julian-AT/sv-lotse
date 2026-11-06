import { approvals, auditEvents, caseActors, messages, turns } from "@lotse/db/schema";
import { isToolUIPart } from "ai";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { CaseTransaction } from "./schema.ts";

export type HistoryEntry = { id: string; at: string; kind: string; data: unknown };
/** Who decided an approval, relative to the viewer. Never exposes another actor's user id. */
export type HistoryActor = "you" | "subject" | "helper" | "unknown";

export async function readCaseHistory(
  tx: CaseTransaction,
  caseId: string,
  viewerId?: string,
): Promise<{
  entries: HistoryEntry[];
  messages: (typeof messages.$inferSelect)[];
}> {
  const stored = await tx
    .select()
    .from(messages)
    .where(eq(messages.caseId, caseId))
    .orderBy(asc(messages.position));
  const approvalRows = await tx
    .select({
      id: approvals.id,
      approvalId: approvals.approvalId,
      toolCallId: approvals.toolCallId,
      toolName: approvals.toolName,
      actorId: approvals.actorId,
      decision: approvals.decision,
      requestedAt: approvals.requestedAt,
      decidedAt: approvals.decidedAt,
      consumedAt: approvals.consumedAt,
      actorUserId: caseActors.userId,
      actorRole: caseActors.role,
    })
    .from(approvals)
    .leftJoin(caseActors, eq(caseActors.id, approvals.actorId))
    .where(eq(approvals.caseId, caseId));
  const decisions = approvalRows.map(({ actorUserId, actorRole, ...row }) => {
    const actor: HistoryActor =
      viewerId && actorUserId === viewerId ? "you" : (actorRole ?? "unknown");
    return { ...row, actor };
  });
  const actors = tx
    .select({ id: caseActors.id })
    .from(caseActors)
    .where(eq(caseActors.caseId, caseId));
  const audit = await tx
    .select()
    .from(auditEvents)
    .where(
      or(
        sql`${auditEvents.target}->>'caseId' = ${caseId}`,
        and(inArray(auditEvents.actorId, actors), sql`${auditEvents.target}->>'caseId' IS NULL`),
      ),
    );
  const recordedTurns = await tx.select().from(turns).where(eq(turns.caseId, caseId));
  const entries: HistoryEntry[] = stored.flatMap((row) =>
    row.uiMessage.parts.map((part, index) => {
      const approval = isToolUIPart(part)
        ? decisions.find((decision) => decision.toolCallId === part.toolCallId)
        : undefined;
      return {
        id: `${row.id}:${index}`,
        at: (approval?.requestedAt ?? row.createdAt).toISOString(),
        kind: part.type,
        data: {
          messageId: row.uiMessage.id,
          role: row.uiMessage.role,
          position: row.position,
          part,
        },
      };
    }),
  );
  for (const row of decisions) {
    entries.push({
      id: `${row.id}:requested`,
      at: row.requestedAt.toISOString(),
      kind: "approval.requested",
      data: {
        id: row.id,
        approvalId: row.approvalId,
        actorId: row.actorId,
        actor: row.actor,
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        decision: "pending",
        requestedAt: row.requestedAt,
      },
    });
    if (row.decidedAt)
      entries.push({
        id: `${row.id}:decided`,
        at: row.decidedAt.toISOString(),
        kind: `approval.${row.decision}`,
        data: row,
      });
  }
  for (const row of audit)
    entries.push({ id: row.id, at: row.occurredAt.toISOString(), kind: row.action, data: row });
  for (const row of recordedTurns)
    row.actionResults.forEach((data, index) => {
      entries.push({
        id: `${row.id}:action:${index}`,
        at: row.createdAt.toISOString(),
        kind: "action.result",
        data,
      });
    });
  // Stable sorting preserves message position and part order for equal timestamps.
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return { entries, messages: stored };
}
