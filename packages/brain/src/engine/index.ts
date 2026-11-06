import { conditionSlots, evaluateCondition } from "./conditions.ts";
import { processCopy } from "./copy.ts";
import {
  type EngineState,
  GOAL_CONFIRMATION_ACTION,
  type JsonValue,
  type ProcessDefinition,
  ProcessError,
  type StepDefinition,
} from "./schema.ts";
import { slotFactType, validSlotValue } from "./slots.ts";

export { evaluateCondition } from "./conditions.ts";
export type { EngineState, JsonValue, ProcessDefinition, StepDefinition } from "./schema.ts";
export {
  engineStateSchema,
  GOAL_CONFIRMATION_ACTION,
  ProcessError,
  processDefinitionSchema,
} from "./schema.ts";
export { applyAnswers } from "./slots.ts";

function validateDefinition(definition: ProcessDefinition): void {
  const all = [...definition.slots, ...definition.steps].map((item) => item.id);
  const stepIds = new Set(definition.steps.map((step) => step.id));
  if (new Set(all).size !== all.length) throw new ProcessError("INVALID_DEFINITION");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(step: StepDefinition): void {
    if (visiting.has(step.id)) throw new ProcessError("INVALID_DEFINITION");
    if (visited.has(step.id)) return;
    visiting.add(step.id);
    if (
      step.needs.some((id) => !all.includes(id)) ||
      step.transitions?.some((edge) => !stepIds.has(edge.to))
    )
      throw new ProcessError("INVALID_DEFINITION");
    for (const dependency of definition.steps.filter((item) => step.needs.includes(item.id)))
      visit(dependency);
    visiting.delete(step.id);
    visited.add(step.id);
  }
  for (const step of definition.steps) visit(step);
}

function isStep(definition: ProcessDefinition, id: string): boolean {
  return definition.steps.some((step) => step.id === id);
}

function transitionTargets(definition: ProcessDefinition): Set<string> {
  return new Set(
    definition.steps.flatMap((step) => step.transitions?.map((edge) => edge.to) ?? []),
  );
}

function initialValues(
  definition: ProcessDefinition,
  contextValues: Readonly<Record<string, JsonValue>>,
  previous?: EngineState,
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const slot of definition.slots) {
    const value = contextValues[slotFactType(slot)] ?? previous?.values[slot.id];
    if (value !== undefined && validSlotValue(slot, value)) values[slot.id] = value;
  }
  return values;
}

function initialSteps(definition: ProcessDefinition): string[] {
  const targets = transitionTargets(definition);
  const roots = definition.steps
    .filter((step) => !targets.has(step.id) && !step.needs.some((id) => isStep(definition, id)))
    .map((step) => step.id);
  // The ordered first step is the entry point for definitions with a back edge to their entry.
  if (roots.length === 0) {
    const first = definition.steps[0];
    if (!first || first.needs.some((id) => isStep(definition, id)))
      throw new ProcessError("INVALID_DEFINITION");
    roots.push(first.id);
  }
  return roots;
}

export function startProcess(
  definition: ProcessDefinition,
  goal: string,
  contextValues: Readonly<Record<string, JsonValue>> = {},
  previous?: EngineState,
): EngineState {
  if (!goal.trim()) throw new ProcessError("GOAL_CONFIRMATION_REQUIRED");
  validateDefinition(definition);
  if (previous?.processId === definition.id && previous.goal === goal) return previous;
  return reconcile(definition, {
    processId: definition.id,
    goal,
    values: initialValues(definition, contextValues, previous),
    asked: previous?.asked ?? [],
    completed: [],
    activated: initialSteps(definition),
    transitioned: [],
  });
}

/** Reconcile joins and conditional branches after answers or completion. */
export function reconcile(definition: ProcessDefinition, input: EngineState): EngineState {
  let state = reconcileOnce(definition, input);
  // Each pass completes at least one step, so back edges between goal steps cannot loop forever.
  for (let pass = 0; pass < definition.steps.length; pass++) {
    const confirmed = goalConfirmationSteps(definition, state);
    if (confirmed.length === 0) break;
    state = reconcileOnce(definition, { ...state, completed: [...state.completed, ...confirmed] });
  }
  return state;
}

/** The pipeline confirmed the goal before the process started, so these steps are already done. */
function goalConfirmationSteps(definition: ProcessDefinition, state: EngineState): string[] {
  if (!state.goal.trim()) return [];
  return openSteps(definition, state)
    .filter(
      (step) =>
        step.action === GOAL_CONFIRMATION_ACTION &&
        missingSlots(definition, state, step).length === 0,
    )
    .map((step) => step.id);
}

function reconcileOnce(definition: ProcessDefinition, state: EngineState): EngineState {
  const activated = new Set(state.activated);
  const completed = new Set(state.completed);
  const transitioned = new Set(state.transitioned);
  const targets = transitionTargets(definition);
  for (const step of definition.steps) {
    const dependencies = step.needs.filter((id) => isStep(definition, id));
    if (
      !targets.has(step.id) &&
      dependencies.length > 0 &&
      dependencies.every((id) => state.completed.includes(id))
    )
      activated.add(step.id);
    if (!completed.has(step.id) || transitioned.has(step.id)) continue;
    transitioned.add(step.id);
    for (const edge of step.transitions ?? []) {
      if (!edge.when || evaluateCondition(edge.when, state.values) === true) {
        activated.add(edge.to);
        // Data may route back to a completed step after clarification. Reopen it without re-asking slots.
        completed.delete(edge.to);
        transitioned.delete(edge.to);
      }
    }
  }
  return {
    ...state,
    activated: [...activated],
    completed: [...completed],
    transitioned: [...transitioned],
  };
}

export function missingSlots(
  definition: ProcessDefinition,
  state: EngineState,
  step: StepDefinition,
): string[] {
  const requested = [
    ...step.needs,
    ...(step.transitions?.flatMap((edge) => conditionSlots(edge.when)) ?? []),
  ];
  return definition.slots
    .filter(
      (slot) =>
        requested.includes(slot.id) &&
        (state.values[slot.id] === undefined ||
          !validSlotValue(slot, state.values[slot.id] as JsonValue)),
    )
    .map((slot) => slot.id);
}

export function openSteps(definition: ProcessDefinition, state: EngineState): StepDefinition[] {
  return definition.steps.filter(
    (step) =>
      state.activated.includes(step.id) &&
      !state.completed.includes(step.id) &&
      step.needs.every((id) => !isStep(definition, id) || state.completed.includes(id)),
  );
}

function extendImpact(step: StepDefinition, state: EngineState, affected: Set<string>): void {
  if (step.needs.some((id) => affected.has(id))) affected.add(step.id);
  if (!affected.has(step.id)) return;
  for (const edge of step.transitions ?? []) {
    if (!edge.when || evaluateCondition(edge.when, state.values) !== false) affected.add(edge.to);
  }
}

function slotImpact(definition: ProcessDefinition, state: EngineState, slotId: string): number {
  const affected = new Set(
    definition.steps
      .filter(
        (step) =>
          !state.completed.includes(step.id) &&
          (step.needs.includes(slotId) ||
            step.transitions?.some((edge) => conditionSlots(edge.when).includes(slotId))),
      )
      .map((step) => step.id),
  );
  for (let index = 0; index < definition.steps.length; index++) {
    for (const step of definition.steps) extendImpact(step, state, affected);
  }
  return affected.size;
}

export function nextQuestion(
  definition: ProcessDefinition,
  input: EngineState,
): {
  state: EngineState;
  step: StepDefinition | null;
  missingSlots: string[];
  slotId: string | null;
  questionHint: string;
} {
  const state = reconcile(definition, input);
  const open = openSteps(definition, state);
  const missing = [...new Set(open.flatMap((step) => missingSlots(definition, state, step)))];
  const candidates = definition.slots.filter(
    (slot) => missing.includes(slot.id) && !state.asked.includes(slot.id),
  );
  candidates.sort(
    (left, right) =>
      slotImpact(definition, state, right.id) - slotImpact(definition, state, left.id),
  );
  const ready = open.find((item) => missingSlots(definition, state, item).length === 0);
  const slot = ready ? undefined : candidates[0];
  const step =
    ready ??
    open.find((item) => slot && missingSlots(definition, state, item).includes(slot.id)) ??
    open[0] ??
    null;
  return {
    state: slot ? { ...state, asked: [...state.asked, slot.id] } : state,
    step,
    missingSlots: missing,
    slotId: slot?.id ?? null,
    questionHint:
      slot?.question_hint ??
      (open.length === 0 ? processCopy.finished : ready ? processCopy.ready : processCopy.waiting),
  };
}

export function completeStep(
  definition: ProcessDefinition,
  input: EngineState,
  stepId: string,
  evidence: Readonly<Record<string, JsonValue>> | undefined,
): EngineState {
  const state = reconcile(definition, input);
  if (state.completed.includes(stepId)) return state;
  const step = openSteps(definition, state).find((item) => item.id === stepId);
  if (!step || missingSlots(definition, state, step).length > 0)
    throw new ProcessError("STEP_NOT_READY");
  const kind = evidence?.type ?? evidence?.kind;
  if (!definition.completion.evidence.some((item) => item === kind))
    throw new ProcessError("INVALID_EVIDENCE");
  const reference =
    kind === "user_statement"
      ? evidence?.text
      : kind === "document_present"
        ? evidence?.documentId
        : evidence?.artifactId;
  if (typeof reference !== "string" || !reference.trim())
    throw new ProcessError("INVALID_EVIDENCE");
  // A known false transition means the reported prerequisites are still outstanding.
  if (
    step.transitions?.length &&
    !step.transitions.some(
      (edge) => !edge.when || evaluateCondition(edge.when, state.values) === true,
    )
  )
    throw new ProcessError("STEP_NOT_READY");
  return reconcile(definition, { ...state, completed: [...state.completed, stepId] });
}
