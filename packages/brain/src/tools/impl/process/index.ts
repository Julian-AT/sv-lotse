import { facts, turns } from "@lotse/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { applyAnswers, nextQuestion, reconcile, startProcess } from "../../../engine/index.ts";
import {
  completePersistedStep,
  contextValues,
  loadDefinition,
  loadProcess,
  lockCase,
  readState,
  retirePlan,
  saveState,
  stateOutput,
  stepKey,
  stepOutput,
  syncSteps,
  type Transaction,
} from "../../../engine/persistence.ts";
import {
  type JsonValue,
  type ProcessDefinition,
  ProcessError,
  type StepDefinition,
} from "../../../engine/schema.ts";
import { slotFactType } from "../../../engine/slots.ts";
import {
  emitProductEvent,
  type ProductEvent,
  stepCompletedEvent,
} from "../../../telemetry/product-events.ts";
import { contracts } from "../../contracts/index.ts";
import { type Implementations, requireDatabase, type ToolDependencies } from "../../types.ts";

function actions(step: StepDefinition | null): Record<string, JsonValue>[] {
  if (!step) return [];
  const result: Record<string, JsonValue>[] = [];
  if (step.action) result.push({ tool: step.action });
  for (const kind of ["criteria", "documents", "form"] as const) {
    const reference = step[kind];
    if (reference) result.push({ kind, reference });
  }
  if (step.signature) result.push({ kind: "signature", owner: step.signature });
  return result;
}

async function persistAnswers(
  tx: Transaction,
  caseId: string,
  subjectId: string,
  definition: ProcessDefinition,
  answers: readonly { id: string; value: JsonValue }[],
): Promise<void> {
  if (answers.length === 0) return;
  const [turn] = await tx
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.caseId, caseId), eq(turns.status, "running")))
    .orderBy(desc(turns.createdAt))
    .limit(1);
  if (!turn) throw new ProcessError("TURN_REQUIRED");
  for (const answer of answers) {
    const slot = definition.slots.find((item) => item.id === answer.id);
    if (!slot) continue;
    // Slot answers are sourced drafts until the existing fact-confirmation flow confirms them.
    await tx.insert(facts).values({
      subjectId,
      type: slotFactType(slot),
      value: answer.value,
      turnId: turn.id,
      source: { kind: "statement", turnId: turn.id },
      confidence: 1,
      confirmed: false,
    });
  }
}

export function implementations(deps: ToolDependencies): Implementations {
  return {
    "process.start": async (raw, context) => {
      const input = contracts["process.start"].input.parse(raw);
      return requireDatabase(deps).transaction(async (tx) => {
        const row = await lockCase(tx, context, input.caseId);
        const loaded = await loadDefinition(tx, input.benefitId);
        if (!loaded.definition.actor_roles.includes(context.actorRole))
          throw new ProcessError("ACCESS_DENIED");
        const values = await contextValues(tx, context.subjectId);
        const previous = readState(row);
        const state = startProcess(loaded.definition, row.confirmedGoal, values, previous);
        await retirePlan(tx, row.id, previous, state);
        const result = { ...loaded, state };
        const steps = await syncSteps(tx, row.id, result, new Date());
        const output = stateOutput(row.id, result, steps.rows);
        await saveState(tx, row, state);
        return output;
      });
    },
    "process.nextStep": async (raw, context) => {
      const input = contracts["process.nextStep"].input.parse(raw);
      return requireDatabase(deps).transaction(async (tx) => {
        const row = await lockCase(tx, context, input.caseId);
        const loaded = await loadProcess(tx, row);
        const next = nextQuestion(loaded.definition, loaded.state);
        loaded.state = next.state;
        const steps = await syncSteps(tx, row.id, loaded, new Date());
        await saveState(tx, row, next.state);
        const step = steps.rows.find(
          (item) => next.step && item.processStep === stepKey(loaded.definition, next.step),
        );
        return {
          step: step ? stepOutput(step) : null,
          missingSlots: next.missingSlots,
          questionHint: next.questionHint,
          actions: step?.status === "pending" ? actions(next.step) : [],
        };
      });
    },
    "process.applyAnswers": async (raw, context) => {
      const input = contracts["process.applyAnswers"].input.parse(raw);
      return requireDatabase(deps).transaction(async (tx) => {
        const row = await lockCase(tx, context, input.caseId);
        const loaded = await loadProcess(tx, row);
        const applied = applyAnswers(loaded.definition, loaded.state, input.answers);
        const invalid = new Set(applied.validationErrors.map((error) => error.slotId));
        const accepted = input.answers.filter(
          (answer) =>
            !invalid.has(answer.id) &&
            JSON.stringify(loaded.state.values[answer.id]) !== JSON.stringify(answer.value),
        );
        await persistAnswers(tx, row.id, row.subjectId, loaded.definition, accepted);
        loaded.state = reconcile(loaded.definition, applied.state);
        const steps = await syncSteps(tx, row.id, loaded, new Date());
        await saveState(tx, row, loaded.state);
        return {
          state: stateOutput(row.id, loaded, steps.rows),
          validationErrors: applied.validationErrors,
        };
      });
    },
    "process.completeStep": async (raw, context) => {
      const input = contracts["process.completeStep"].input.parse(raw);
      let event: ProductEvent | undefined;
      const output = await requireDatabase(deps).transaction(async (tx) => {
        const row = await lockCase(tx, context, input.caseId);
        const result = await completePersistedStep(
          tx,
          row,
          input.stepId,
          input.evidence,
          (completed) => {
            event = stepCompletedEvent(completed.benefitId, completed.stepId, context);
          },
        );
        return {
          steps: result.rows.map(stepOutput),
          reminders: result.reminders,
          preparedArtifacts: result.preparedArtifacts,
        };
      });
      // Reported only after the transaction has committed.
      emitProductEvent(deps.analytics, event);
      return output;
    },
  };
}
