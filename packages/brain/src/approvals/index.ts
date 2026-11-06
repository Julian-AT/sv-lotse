import type { DatabaseClient } from "@lotse/db";
import { approvals, auditEvents, caseActors, sessions } from "@lotse/db/schema";
import { ApprovalContextSchema, ProvenanceSchema } from "@lotse/protocol";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { allowedToolNames } from "../agent/permissions.ts";
import { fillIsAllowed } from "../autonomy/booking.ts";
import { rejectContinuation } from "../conversation/errors.ts";
import { acquisitionSummary } from "../forms/acquire/summary.ts";
import {
  actionEvent,
  emitProductEvent,
  type ProductEventSink,
} from "../telemetry/product-events.ts";
import { contracts, isToolName } from "../tools/contracts/index.ts";
import { approvalHmac, equalHmac, inputHash } from "./canonical.ts";

export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type ApprovalCall = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
};

const APPROVAL_SUMMARIES: Readonly<Record<string, string>> = {
  "ui.fill": "Den angezeigten Wert aus der angegebenen Quelle in das markierte Feld eintragen.",
  "form.commitGroup": "Die angezeigten Entwürfe dieser Feldgruppe bestätigen.",
  "calendar.createEvent": "Den angezeigten Termin in Ihrem Kalender speichern.",
};
const SHARE_APPROVAL_SUMMARY =
  "Den angezeigten Umfang dieses Falls mit einer helfenden Person teilen.";

export function createApprovalService(
  db: DatabaseClient,
  secret: string,
  analytics?: ProductEventSink,
) {
  async function request(call: ApprovalCall, context: RuntimeContext) {
    if (
      !isToolName(call.toolName) ||
      !contracts[call.toolName].approval ||
      !allowedToolNames(context.autonomyLevel, context.actorRole).includes(call.toolName) ||
      context.actorRole !== "subject" ||
      context.autonomyLevel === "L1"
    )
      rejectContinuation();
    if (call.toolName === "ui.fill" && !(await fillIsAllowed(db, call.input, context)))
      rejectContinuation();
    const formSummary =
      call.toolName === "form.acquire"
        ? await acquisitionSummary(
            db,
            context.caseId,
            call.input,
            context.responsePreferences?.language === "en" ? "en" : "de",
          )
        : undefined;
    const binding = {
      approvalId: call.approvalId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      inputHash: inputHash(call.input),
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
    emitProductEvent(analytics, actionEvent("action_proposed", call, context.autonomyLevel));
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
      summary: formSummary ?? APPROVAL_SUMMARIES[call.toolName] ?? SHARE_APPROVAL_SUMMARY,
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
      (approved && context.autonomyLevel === "L1")
    )
      rejectContinuation();
    if (
      !isToolName(call.toolName) ||
      (approved &&
        !allowedToolNames(context.autonomyLevel, context.actorRole).includes(call.toolName))
    )
      rejectContinuation();
    if (approved && call.toolName === "ui.fill" && !(await fillIsAllowed(tx, call.input, context)))
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
    emitProductEvent(
      analytics,
      actionEvent(approved ? "action_approved" : "action_rejected", call, context.autonomyLevel),
    );
  }

  return { request, decide };
}
