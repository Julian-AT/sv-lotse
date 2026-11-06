import { caseActors, caseSteps } from "@lotse/db/schema";
import { type CaseEvent, CaseEventSchema } from "@lotse/protocol";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { processCopy } from "../engine/copy.ts";
import {
  type CaseRow,
  completePersistedStep,
  readState,
  type StepRow,
} from "../engine/persistence.ts";
import type { JsonValue } from "../engine/schema.ts";
import { authorizeCase, requireIdleCase } from "./access.ts";
import { appendCaseEvent } from "./events.ts";
import { CaseFileError, type CaseTransaction, stepInputSchema, stepPatchSchema } from "./schema.ts";

type StepInput = z.infer<typeof stepInputSchema>;
type StepPatch = z.infer<typeof stepPatchSchema>;

function stepEvent(step: StepRow): CaseEvent {
  return CaseEventSchema.parse({
    caseId: step.caseId,
    kind: step.status === "completed" ? "step_completed" : "step_created",
    payload: {
      ...step,
      dueAt: step.dueAt?.toISOString() ?? null,
      createdAt: step.createdAt.toISOString(),
    },
  });
}

function mergedInput(existing: StepRow | undefined, changes: StepPatch): StepInput {
  return stepInputSchema.parse({
    ...(existing
      ? {
          processStep: existing.processStep,
          status: existing.status,
          owner: existing.owner,
          linkedArtifacts: existing.linkedArtifacts,
          initiatedBy: existing.initiatedBy,
        }
      : {}),
    ...changes,
    dueAt: changes.dueAt === undefined ? (existing?.dueAt?.toISOString() ?? null) : changes.dueAt,
  });
}

async function completionEvents(
  tx: CaseTransaction,
  caseId: string,
  existing: StepRow,
  result: Awaited<ReturnType<typeof completePersistedStep>>,
): Promise<void> {
  if (existing.status === "completed") return;
  for (const next of result.rows.filter(
    (row) => row.id !== existing.id && row.status !== "completed",
  ))
    await appendCaseEvent(tx, {
      caseId,
      kind: "step_created",
      payload: {
        id: next.id,
        status: next.status,
        owner: next.owner,
        initiatedBy: next.initiatedBy,
      },
    });
  for (const id of result.reminders)
    await appendCaseEvent(tx, { caseId, kind: "reminder_created", payload: { id } });
  for (const id of result.preparedArtifacts)
    await appendCaseEvent(tx, { caseId, kind: "artefact_ready", payload: { id } });
}

async function completeCaseStep(
  tx: CaseTransaction,
  row: CaseRow,
  userId: string,
  existing: StepRow,
  changes: StepPatch,
  evidence?: Record<string, JsonValue>,
): Promise<StepRow> {
  if (Object.keys(changes).some((key) => key !== "status"))
    throw new CaseFileError("invalid_input");
  const [actor] = await tx
    .select({ id: caseActors.id })
    .from(caseActors)
    .where(
      and(
        eq(caseActors.caseId, row.id),
        eq(caseActors.userId, userId),
        eq(caseActors.role, "subject"),
      ),
    );
  if (!actor) throw new CaseFileError("access_denied");
  const result = await completePersistedStep(
    tx,
    row,
    existing.id,
    evidence ?? { type: "user_statement", text: processCopy.userCompleted },
  );
  const step = result.rows.find((item) => item.id === existing.id);
  if (!step) throw new CaseFileError("not_found");
  await completionEvents(tx, row.id, existing, result);
  return step;
}

async function persistManualStep(
  tx: CaseTransaction,
  caseId: string,
  input: StepInput,
  stepId?: string,
): Promise<StepRow> {
  const values = { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null };
  const [step] = stepId
    ? await tx
        .update(caseSteps)
        .set(values)
        .where(and(eq(caseSteps.id, stepId), eq(caseSteps.caseId, caseId)))
        .returning()
    : await tx
        .insert(caseSteps)
        .values({ ...values, caseId })
        .returning();
  if (!step) throw new CaseFileError("not_found");
  return step;
}

export async function saveCaseStep(
  tx: CaseTransaction,
  userId: string,
  caseId: string,
  raw: unknown,
  stepId?: string,
  evidence?: Record<string, JsonValue>,
): Promise<{ step: StepRow; event: CaseEvent }> {
  z.uuid().parse(caseId);
  if (stepId !== undefined) z.uuid().parse(stepId);
  const authorized = await authorizeCase(tx, caseId, userId, true);
  await requireIdleCase(tx, caseId);
  const [existing] = stepId
    ? await tx
        .select()
        .from(caseSteps)
        .where(and(eq(caseSteps.id, stepId), eq(caseSteps.caseId, caseId)))
    : [];
  if (stepId && !existing) throw new CaseFileError("not_found");
  const changes = stepId ? stepPatchSchema.parse(raw) : stepInputSchema.parse(raw);
  const input = mergedInput(existing, changes);
  const state = readState(authorized.case);
  const engineStep = existing && state && existing.processStep.startsWith(`${state.processId}/`);
  if (engineStep && input.status !== "completed") throw new CaseFileError("invalid_input");
  const step = engineStep
    ? await completeCaseStep(tx, authorized.case, userId, existing, changes, evidence)
    : await persistManualStep(tx, caseId, input, stepId);
  const event = stepEvent(step);
  if (!engineStep || existing.status !== "completed") await appendCaseEvent(tx, event);
  return { step, event };
}
