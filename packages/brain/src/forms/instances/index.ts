import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import { approvals, auditEvents, facts, formFields, formInstances, turns } from "@lotse/db/schema";
import { ActionSchema, JsonObjectSchema, type JsonValue, ProvenanceSchema } from "@lotse/protocol";
import { and, desc, eq } from "drizzle-orm";
import type { RuntimeContext } from "../../agent/context.ts";
import { canonicalJson, inputHash } from "../../approvals/canonical.ts";
import type { Transaction } from "../../approvals/index.ts";
import { FORM_TYPE_PACE_MS } from "../../config/index.ts";
import { contracts } from "../../tools/contracts/index.ts";
import type { ToolDependencies } from "../../tools/types.ts";
import {
  factProvenance,
  ibanField,
  proposeFields,
  validFieldValue,
  writableField,
} from "../policy.ts";
import { getFormSchema, getTemplate, templateForUse } from "../registry/index.ts";
import { FormError, type FormField, type FormToolResult, templateSchema } from "../schema.ts";
import { authorizeFormCase, instanceForContext } from "./access.ts";
import { confirmedFormFacts } from "./facts.ts";

export async function prefillForm(
  db: DatabaseClient,
  raw: unknown,
  context: RuntimeContext,
  signal?: AbortSignal,
): Promise<FormToolResult<"form.prefill">> {
  const input = contracts["form.prefill"].input.parse(raw);
  if (
    input.caseId !== context.caseId ||
    input.subjectId !== context.subjectId ||
    context.actorRole !== "subject"
  )
    throw new FormError("access_denied");
  await authorizeFormCase(db, context.userId, input.caseId, input.subjectId);
  const template = await templateForUse(db, input.templateId, signal);
  const schema = await getFormSchema(db, template, signal);
  const confirmed = await confirmedFormFacts(db, input.subjectId);
  const proposed = proposeFields(schema.fields, confirmed);
  const fields = formFields.parse(
    Object.fromEntries(
      proposed.proposals.map((proposal) => [
        proposal.fieldId,
        {
          value: proposal.value,
          provenance: proposal.provenance,
          state: "draft",
          approvalId: null,
        },
      ]),
    ),
  );
  const formInstanceId = randomUUID();
  await db.insert(formInstances).values({
    id: formInstanceId,
    caseId: input.caseId,
    subjectId: input.subjectId,
    templateId: template.id,
    fields,
  });
  return { formInstanceId, ...proposed };
}

function selectedFields(fields: FormField[], ids: string[]): FormField[] {
  if (!ids.length || new Set(ids).size !== ids.length) throw new FormError("invalid_fields");
  return ids.map((id) => {
    const field = fields.find((item) => item.id === id);
    if (!field || !writableField(field)) throw new FormError("invalid_fields");
    return field;
  });
}

export async function fillLiveForm(
  db: DatabaseClient,
  dependencies: ToolDependencies,
  raw: unknown,
  context: RuntimeContext,
  signal?: AbortSignal,
): Promise<FormToolResult<"form.fillLive">> {
  const input = contracts["form.fillLive"].input.parse(raw);
  if (context.autonomyLevel === "L1") throw new FormError("access_denied");
  const writer = dependencies.writer;
  if (!writer) throw new FormError("action_writer_required");
  const instance = await instanceForContext(db, input.formInstanceId, context);
  const schema = templateSchema(await getTemplate(db, instance.templateId));
  const selected = selectedFields(schema.fields, input.fieldIds);
  const values = formFields.parse(instance.fields);
  const confirmed = await confirmedFormFacts(db, context.subjectId);
  // Validate the complete group before exposing even its first action.
  const actions = selected.map((field) => {
    const value = values[field.id];
    if (!value || !validFieldValue(field, value.value)) throw new FormError("invalid_fields");
    const provenance = ProvenanceSchema.parse(value.provenance);
    const sourceFact = confirmed.find(
      (fact) =>
        fact.id === provenance.factId && canonicalJson(fact.value) === canonicalJson(value.value),
    );
    if (!sourceFact || !factProvenance(sourceFact, field)) throw new FormError("invalid_fields");
    return ActionSchema.parse({
      id: randomUUID(),
      kind: "type",
      sentenceIndex: context.sentenceIndex,
      target: { kind: "form", formInstanceId: instance.id, fieldId: field.id },
      payload: {
        value: String(value.value),
        provenance,
        pace: input.pace ?? FORM_TYPE_PACE_MS,
      },
    });
  });
  signal?.throwIfAborted();
  for (const action of actions) {
    signal?.throwIfAborted();
    writer.write({ type: "data-action", data: action });
  }
  return { actionIds: actions.map((action) => action.id) };
}

async function approvedCall(
  tx: Transaction,
  raw: unknown,
  context: RuntimeContext,
  toolCallId: string,
) {
  if (context.actorRole !== "subject" || context.autonomyLevel === "L1")
    throw new FormError("approval_required");
  const [approval] = await tx
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.caseId, context.caseId),
        eq(approvals.actorId, context.actorId),
        eq(approvals.sessionId, context.sessionId),
        eq(approvals.toolCallId, toolCallId),
        eq(approvals.toolName, "form.commitGroup"),
        eq(approvals.decision, "approved"),
        eq(approvals.inputHash, inputHash(raw)),
      ),
    )
    .for("update");
  if (!approval?.consumedAt) throw new FormError("approval_required");
  const [replay] = await tx
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.approvalId, approval.approvalId),
        eq(auditEvents.action, "form.commitGroup"),
      ),
    );
  if (replay) throw new FormError("approval_required");
  return approval;
}

async function correctedValue(
  tx: Transaction,
  field: FormField,
  value: JsonValue,
  context: RuntimeContext,
  approvalId: string,
  templateId: string,
) {
  // The exact correction is displayed in the approval card. Its approval is the user's statement.
  // IBAN changes require an independently captured statement fact, never an inferred correction.
  const confirmed = await confirmedFormFacts(tx, context.subjectId);
  const factType = field.fact_type ?? `form.field.${templateId}.${field.id}`;
  const matching = confirmed.find(
    (fact) =>
      fact.type === factType &&
      canonicalJson(fact.value) === canonicalJson(value) &&
      factProvenance(fact, field),
  );
  if (matching) return JsonObjectSchema.parse(factProvenance(matching, field));
  if (ibanField(field)) throw new FormError("invalid_fields");
  const [turn] = await tx
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.caseId, context.caseId), eq(turns.status, "running")))
    .orderBy(desc(turns.createdAt))
    .limit(1);
  if (!turn) throw new FormError("invalid_fields");
  const id = randomUUID();
  const source = { kind: "statement" as const, turnId: turn.id, quote: String(value) };
  await tx.insert(facts).values({
    id,
    subjectId: context.subjectId,
    type: factType,
    value,
    turnId: turn.id,
    source,
    confidence: 1,
    confirmed: true,
  });
  await tx.insert(auditEvents).values({
    actorId: context.actorId,
    action: "form.correction",
    target: { factId: id, caseId: context.caseId },
    approvalId,
  });
  return JsonObjectSchema.parse({ factId: id, source });
}

export async function commitFormGroup(
  db: DatabaseClient,
  raw: unknown,
  context: RuntimeContext,
  toolCallId: string,
): Promise<FormToolResult<"form.commitGroup">> {
  const input = contracts["form.commitGroup"].input.parse(raw);
  if (
    Object.keys(input.values).length !== input.fieldIds.length ||
    input.fieldIds.some((id) => !(id in input.values))
  )
    throw new FormError("invalid_fields");
  return db.transaction(async (tx) => {
    const approval = await approvedCall(tx, input, context, toolCallId);
    const instance = await instanceForContext(tx, input.formInstanceId, context, true);
    const template = await getTemplate(tx, instance.templateId);
    const selected = selectedFields(templateSchema(template).fields, input.fieldIds);
    const fields = formFields.parse(instance.fields);
    for (const field of selected) {
      const value = input.values[field.id];
      if (value === undefined || !validFieldValue(field, value))
        throw new FormError("invalid_fields");
      const provenance = await correctedValue(
        tx,
        field,
        value,
        context,
        approval.approvalId,
        instance.templateId,
      );
      fields[field.id] = { value, provenance, state: "confirmed", approvalId: approval.approvalId };
    }
    await tx
      .update(formInstances)
      .set({ fields, outputKey: null })
      .where(eq(formInstances.id, instance.id));
    await tx.insert(auditEvents).values({
      actorId: context.actorId,
      action: "form.commitGroup",
      target: { formInstanceId: instance.id },
      approvalId: approval.approvalId,
    });
    return { values: input.values, approvalId: approval.approvalId };
  });
}
