import type { DatabaseClient } from "@lotse/db";
import { approvals, auditEvents, caseActors, sessions } from "@lotse/db/schema";
import { ApprovalContextSchema, ProvenanceSchema } from "@lotse/protocol";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { rejectContinuation } from "../conversation/errors.ts";
import { contracts, isToolName } from "../tools/contracts/index.ts";
import { approvalHmac, equalHmac, inputHash } from "./canonical.ts";

export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type ApprovalCall = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};
export function createApprovalService(db: DatabaseClient, secret: string) {
  async function request(call: ApprovalCall, context: RuntimeContext) {
    if (
      !isToolName(call.toolName) ||
      !contracts[call.toolName].approval ||
      context.actorRole !== "subject" ||
      context.autonomyLevel === "L1"
    )
      rejectContinuation();
    const hash = inputHash(call.input);
    const binding = {
      approvalId: call.approvalId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      inputHash: hash,
    };
    await db.transaction(async (tx) => {
      await tx.insert(approvals).values({
        ...binding,
        caseId: context.caseId,
        actorId: context.actorId,
        sessionId: context.sessionId,
        hmac: approvalHmac(binding, secret),
      });
      await tx.insert(auditEvents).values({
        actorId: context.actorId,
        action: "approval.requested",
        target: { caseId: context.caseId, toolCallId: call.toolCallId },
        approvalId: call.approvalId,
      });
    });
    const withProvenance = z
      .object({ provenance: ProvenanceSchema.optional() })
      .safeParse(call.input);
    return ApprovalContextSchema.parse({
      ...binding,
      caseId: context.caseId,
      provenance:
        withProvenance.success && withProvenance.data.provenance
          ? [withProvenance.data.provenance]
          : [],
      summary:
        call.toolName === "ui.fill"
          ? "Den angezeigten Wert aus der angegebenen Quelle in das markierte Feld eintragen."
          : call.toolName === "form.commitGroup"
            ? "Die angezeigten Entwürfe dieser Feldgruppe bestätigen."
            : call.toolName === "calendar.createEvent"
              ? "Den angezeigten Termin in Ihrem Kalender speichern."
              : "Den angezeigten Umfang dieses Falls mit einer helfenden Person teilen.",
    });
  }
  async function decide(
    tx: Transaction,
    call: ApprovalCall,
    context: RuntimeContext,
    approved: boolean,
  ) {
    const [row] = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.approvalId, call.approvalId))
      .for("update");
    if (
      !row ||
      row.caseId !== context.caseId ||
      row.sessionId !== context.sessionId ||
      row.actorId !== context.actorId ||
      row.toolCallId !== call.toolCallId ||
      row.toolName !== call.toolName ||
      row.decision !== "pending" ||
      row.consumedAt !== null ||
      context.actorRole !== "subject" ||
      context.autonomyLevel === "L1"
    )
      rejectContinuation();
    const hash = inputHash(call.input);
    const binding = {
      approvalId: row.approvalId,
      toolCallId: row.toolCallId,
      toolName: row.toolName,
      inputHash: hash,
    };
    if (hash !== row.inputHash || !equalHmac(row.hmac, approvalHmac(binding, secret)))
      rejectContinuation();
    const [actor] = await tx
      .select({ id: caseActors.id })
      .from(caseActors)
      .innerJoin(sessions, eq(sessions.userId, caseActors.userId))
      .where(
        and(
          eq(caseActors.id, context.actorId),
          eq(caseActors.caseId, context.caseId),
          eq(caseActors.role, "subject"),
          eq(sessions.id, context.sessionId),
          eq(sessions.userId, context.userId),
          gt(sessions.expiresAt, sql`clock_timestamp()`),
        ),
      );
    if (!actor) rejectContinuation();
    const decision = approved ? "approved" : "denied";
    const [updated] = await tx
      .update(approvals)
      .set({
        decision,
        decidedAt: sql`clock_timestamp()`,
        ...(approved ? { consumedAt: sql`clock_timestamp()` } : {}),
      })
      .where(
        and(
          eq(approvals.id, row.id),
          eq(approvals.decision, "pending"),
          isNull(approvals.consumedAt),
        ),
      )
      .returning({ id: approvals.id });
    if (!updated) rejectContinuation();
    await tx.insert(auditEvents).values({
      actorId: context.actorId,
      action: `approval.${decision}`,
      target: { caseId: context.caseId, toolCallId: call.toolCallId },
      approvalId: call.approvalId,
    });
  }
  return { request, decide };
}
