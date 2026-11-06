import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "@lotse/db";
import {
  benefits,
  caseActors,
  caseSteps,
  cases,
  facts,
  processes,
  reminders,
} from "@lotse/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { PROCESS_DAY_MS } from "../config/index.ts";
import { benefitRecordSchema } from "../tools/contracts/records.ts";
import { preparedArtifacts } from "./artifacts.ts";
import type { BenefitRecord } from "./catalog.ts";
import { evaluateCondition } from "./conditions.ts";
import { processCopy } from "./copy.ts";
import { validateEvidence } from "./evidence.ts";
import { completeStep, missingSlots, nextQuestion, openSteps, reconcile } from "./index.ts";
import {
  type EngineState,
  engineStateSchema,
  type JsonValue,
  type ProcessDefinition,
  ProcessError,
  processDefinitionSchema,
  type StepDefinition,
} from "./schema.ts";
import { hydrateContext } from "./slots.ts";

export type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
export type CaseRow = typeof cases.$inferSelect;
export type StepRow = typeof caseSteps.$inferSelect;
export type LoadedProcess = {
  definition: ProcessDefinition;
  benefit: BenefitRecord;
  state: EngineState;
};

export async function lockCase(
  tx: Transaction,
  context: RuntimeContext,
  caseId: string,
): Promise<CaseRow> {
  if (caseId !== context.caseId || context.actorRole !== "subject")
    throw new ProcessError("ACCESS_DENIED");
  const [row] = await tx
    .select({ record: cases })
    .from(cases)
    .innerJoin(
      caseActors,
      and(
        eq(caseActors.caseId, cases.id),
        eq(caseActors.id, context.actorId),
        eq(caseActors.userId, context.userId),
        eq(caseActors.role, "subject"),
      ),
    )
    .where(and(eq(cases.id, caseId), eq(cases.subjectId, context.subjectId)))
    .for("update", { of: cases });
  if (!row) throw new ProcessError("ACCESS_DENIED");
  if (!row.record.confirmedGoal.trim()) throw new ProcessError("GOAL_CONFIRMATION_REQUIRED");
  return row.record;
}

export function readState(row: CaseRow): EngineState | undefined {
  const envelope = z.object({ process: engineStateSchema }).safeParse(row.journeyMap);
  return envelope.success ? envelope.data.process : undefined;
}

export async function loadDefinition(
  tx: Transaction,
  benefitId: string,
): Promise<{ definition: ProcessDefinition; benefit: BenefitRecord }> {
  const [row] = await tx.select().from(benefits).where(eq(benefits.key, benefitId));
  if (!row) throw new ProcessError("BENEFIT_NOT_FOUND");
  const benefit = benefitRecordSchema.parse(row.record);
  const [process] = await tx
    .select()
    .from(processes)
    .where(
      and(
        eq(processes.benefitId, row.id),
        eq(processes.key, benefit.process.slice("ref:processes/".length)),
      ),
    );
  if (!process) throw new ProcessError("PROCESS_NOT_FOUND");
  return { benefit, definition: processDefinitionSchema.parse(process.record) };
}

export async function loadProcess(tx: Transaction, row: CaseRow): Promise<LoadedProcess> {
  const state = readState(row);
  if (!state) throw new ProcessError("PROCESS_NOT_STARTED");
  if (state.goal !== row.confirmedGoal) throw new ProcessError("GOAL_CONFIRMATION_REQUIRED");
  const [record] = await tx
    .select({ process: processes.record, benefit: benefits.record })
    .from(processes)
    .innerJoin(benefits, eq(processes.benefitId, benefits.id))
    .where(eq(processes.key, state.processId));
  if (!record) throw new ProcessError("PROCESS_NOT_FOUND");
  const definition = processDefinitionSchema.parse(record.process);
  return {
    definition,
    benefit: benefitRecordSchema.parse(record.benefit),
    state: hydrateContext(definition, state, await contextValues(tx, row.subjectId)),
  };
}

export async function contextValues(
  tx: Transaction,
  subjectId: string,
): Promise<Record<string, JsonValue>> {
  const rows = await tx
    .select()
    .from(facts)
    .where(and(eq(facts.subjectId, subjectId), eq(facts.confirmed, true)))
    .orderBy(asc(facts.createdAt), asc(facts.id));
  return Object.fromEntries(rows.map((row) => [row.type, row.value]));
}

export async function saveState(tx: Transaction, row: CaseRow, state: EngineState): Promise<void> {
  const prior = row.journeyMap;
  const envelope =
    prior !== null && typeof prior === "object" && !Array.isArray(prior)
      ? prior
      : { previousJourneyMap: prior };
  await tx
    .update(cases)
    .set({ journeyMap: { ...envelope, process: state } })
    .where(eq(cases.id, row.id));
}

export async function retirePlan(
  tx: Transaction,
  caseId: string,
  previous: EngineState | undefined,
  next: EngineState,
): Promise<void> {
  if (!previous || (previous.processId === next.processId && previous.goal === next.goal)) return;
  const steps = await tx.select().from(caseSteps).where(eq(caseSteps.caseId, caseId));
  for (const step of steps.filter(
    (item) => item.processStep.startsWith(`${previous.processId}/`) && item.status !== "completed",
  )) {
    await tx.update(caseSteps).set({ status: "blocked" }).where(eq(caseSteps.id, step.id));
  }
  const scheduled = await tx.select().from(reminders).where(eq(reminders.caseId, caseId));
  for (const reminder of scheduled) {
    const source = z
      .object({ key: z.string(), provenance: z.object({ processId: z.string() }) })
      .safeParse(reminder.source);
    if (
      source.success &&
      source.data.key.startsWith("process:") &&
      source.data.provenance.processId === previous.processId
    )
      await tx.delete(reminders).where(eq(reminders.id, reminder.id));
  }
}

export function stepKey(definition: ProcessDefinition, step: StepDefinition): string {
  return `${definition.id}/${step.id}`;
}
export function stepOutput(row: StepRow): {
  id: string;
  status: StepRow["status"];
  owner: StepRow["owner"];
  description: string;
} {
  return {
    id: row.id,
    status: row.status,
    owner: row.owner,
    description: row.status === "completed" ? processCopy.completed : processCopy.prepared,
  };
}

async function prepareReminders(
  tx: Transaction,
  caseId: string,
  definition: ProcessDefinition,
  state: EngineState,
  step: StepDefinition,
  row: StepRow,
  now: Date,
): Promise<string[]> {
  const created: string[] = [];
  const existing = await tx.select().from(reminders).where(eq(reminders.caseId, caseId));
  for (const [index, reminder] of (step.reminders ?? []).entries()) {
    if (reminder.when && evaluateCondition(reminder.when, state.values) !== true) continue;
    const key = `process:${row.id}:${index}`;
    if (existing.some((item) => item.source.key === key)) continue;
    const id = randomUUID();
    const source = definition.sources[0];
    if (!source) throw new ProcessError("INVALID_DEFINITION");
    await tx.insert(reminders).values({
      id,
      caseId,
      dueAt: new Date(now.getTime() + reminder.after_days * PROCESS_DAY_MS),
      source: {
        kind: "manual",
        key,
        title: reminder.text_de,
        sourceQuote: source.quote,
        provenance: {
          processId: definition.id,
          stepId: row.id,
          taskReminder: true,
          sources: definition.sources,
          asOf: definition.as_of,
        },
      },
    });
    created.push(id);
  }
  return created;
}

async function persistStep(
  tx: Transaction,
  caseId: string,
  loaded: LoadedProcess,
  step: StepDefinition,
  prior: StepRow | undefined,
  open: boolean,
): Promise<StepRow> {
  const { definition, state, benefit } = loaded;
  const status = state.completed.includes(step.id)
    ? "completed"
    : open && missingSlots(definition, state, step).length === 0
      ? "pending"
      : "blocked";
  const id = prior?.id ?? randomUUID();
  const [row] = prior
    ? await tx.update(caseSteps).set({ status }).where(eq(caseSteps.id, id)).returning()
    : await tx
        .insert(caseSteps)
        .values({
          id,
          caseId,
          processStep: stepKey(definition, step),
          status,
          owner: "user",
          initiatedBy: "pilot",
          linkedArtifacts: await preparedArtifacts(tx, caseId, step, benefit, definition),
        })
        .returning();
  if (!row) throw new ProcessError("PROCESS_NOT_FOUND");
  return row;
}

function artifactIds(artifacts: readonly JsonValue[]): string[] {
  return artifacts.flatMap((artifact) => {
    const parsed = z.object({ id: z.string() }).safeParse(artifact);
    return parsed.success ? [parsed.data.id] : [];
  });
}

export async function syncSteps(
  tx: Transaction,
  caseId: string,
  loaded: LoadedProcess,
  now: Date,
): Promise<{ rows: StepRow[]; reminders: string[]; preparedArtifacts: string[] }> {
  const { definition, state } = loaded;
  const existing = await tx.select().from(caseSteps).where(eq(caseSteps.caseId, caseId));
  const rows: StepRow[] = [];
  const reminderIds: string[] = [];
  const preparedIds: string[] = [];
  const open = new Set(openSteps(definition, state).map((step) => step.id));
  for (const step of definition.steps.filter((item) => state.activated.includes(item.id))) {
    const key = stepKey(definition, step);
    const prior = existing.find((row) => row.processStep === key);
    const row = await persistStep(tx, caseId, loaded, step, prior, open.has(step.id));
    rows.push(row);
    if (!prior) preparedIds.push(...artifactIds(row.linkedArtifacts));
    if (row.status !== "completed" && !step.on_complete?.includes("reminder.create"))
      reminderIds.push(...(await prepareReminders(tx, caseId, definition, state, step, row, now)));
  }
  return { rows, reminders: reminderIds, preparedArtifacts: preparedIds };
}

export function stateOutput(
  caseId: string,
  loaded: LoadedProcess,
  rows: StepRow[],
): {
  caseId: string;
  slots: { id: string; value: JsonValue }[];
  firstMissingSlot: string | null;
  steps: ReturnType<typeof stepOutput>[];
} {
  return {
    caseId,
    slots: Object.entries(loaded.state.values).map(([id, value]) => ({ id, value })),
    firstMissingSlot: nextQuestion(loaded.definition, loaded.state).slotId,
    steps: rows.map(stepOutput),
  };
}

/** Caller holds the case lock and has authorized a persisted subject actor. Shared by HTTP and tools. */
export async function completePersistedStep(
  tx: Transaction,
  row: CaseRow,
  stepId: string,
  evidence?: Record<string, JsonValue>,
  onCompleted?: (completed: { benefitId: string; stepId: string }) => void,
): Promise<Awaited<ReturnType<typeof syncSteps>>> {
  const loaded = await loadProcess(tx, row);
  const rows = await tx.select().from(caseSteps).where(eq(caseSteps.caseId, row.id));
  const stored = rows.find((item) => item.id === stepId);
  const step = loaded.definition.steps.find(
    (item) =>
      item.id === stepId || (stored && stored.processStep === stepKey(loaded.definition, item)),
  );
  if (!step) throw new ProcessError("STEP_NOT_READY");
  const newlyCompleted = !loaded.state.completed.includes(step.id);
  if (newlyCompleted) await validateEvidence(tx, row.id, row.subjectId, evidence);
  loaded.state = completeStep(loaded.definition, loaded.state, step.id, evidence);
  const completionReminders: string[] = [];
  const completionArtifacts: string[] = [];
  if (newlyCompleted) {
    const target = rows.find((item) => item.processStep === stepKey(loaded.definition, step));
    if (!target) throw new ProcessError("STEP_NOT_READY");
    const artifacts = await runCompletionActions(
      tx,
      row.id,
      loaded,
      step,
      target,
      completionReminders,
    );
    completionArtifacts.push(...artifactIds(artifacts));
    await tx
      .update(caseSteps)
      .set({
        linkedArtifacts: [
          ...target.linkedArtifacts,
          ...artifacts,
          ...(evidence ? [{ type: "completion_evidence", value: evidence }] : []),
        ],
      })
      .where(eq(caseSteps.id, target.id));
  }
  const result = await syncSteps(tx, row.id, loaded, new Date());
  await saveState(tx, row, loaded.state);
  if (newlyCompleted) onCompleted?.({ benefitId: loaded.benefit.id, stepId: step.id });
  return {
    rows: result.rows,
    reminders: [...completionReminders, ...result.reminders],
    preparedArtifacts: [...completionArtifacts, ...result.preparedArtifacts],
  };
}

async function runCompletionActions(
  tx: Transaction,
  caseId: string,
  loaded: LoadedProcess,
  step: StepDefinition,
  target: StepRow,
  reminderIds: string[],
): Promise<JsonValue[]> {
  const artifacts: JsonValue[] = [];
  // Only deterministic administrative actions can run from declarative process data.
  // Approval-gated tools and external mutations must never be dispatched by on_complete.
  for (const action of new Set(step.on_complete ?? [])) {
    if (action === "process.nextStep") loaded.state = reconcile(loaded.definition, loaded.state);
    else if (action === "reminder.create")
      reminderIds.push(
        ...(await prepareReminders(
          tx,
          caseId,
          loaded.definition,
          loaded.state,
          step,
          target,
          new Date(),
        )),
      );
    else if (action === "documents.checklist" || action === "appointment.prepare") {
      const generated = await preparedArtifacts(
        tx,
        caseId,
        action === "appointment.prepare" ? { ...step, action } : step,
        loaded.benefit,
        loaded.definition,
      );
      artifacts.push(
        ...generated.filter((artifact) => {
          const parsed = z.object({ type: z.string() }).parse(artifact);
          return !target.linkedArtifacts.some(
            (prior) => z.object({ type: z.literal(parsed.type) }).safeParse(prior).success,
          );
        }),
      );
    } else throw new ProcessError("INVALID_DEFINITION");
  }
  return artifacts;
}
