import { z } from "zod";
import { processCopy } from "./copy.ts";
import type { EngineState, JsonValue, ProcessDefinition, SlotDefinition } from "./schema.ts";

function typedValue(slot: SlotDefinition, value: JsonValue): boolean {
  if (value === null) return false;
  if (slot.type === "boolean") return typeof value === "boolean";
  if (slot.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (slot.type === "date") return z.iso.date().safeParse(value).success;
  if (slot.type.startsWith("fact:")) return true;
  return typeof value === "string" && value.trim().length > 0;
}

export function slotFactType(slot: SlotDefinition): string {
  return (
    slot.from_context ?? (slot.type.startsWith("fact:") ? slot.type.slice("fact:".length) : slot.id)
  );
}

export function hydrateContext(
  definition: ProcessDefinition,
  state: EngineState,
  context: Readonly<Record<string, JsonValue>>,
): EngineState {
  const values = { ...state.values };
  for (const slot of definition.slots) {
    if (values[slot.id] !== undefined) continue;
    const value = context[slotFactType(slot)];
    if (value !== undefined && validSlotValue(slot, value)) values[slot.id] = value;
  }
  return { ...state, values };
}
export function validSlotValue(slot: SlotDefinition, value: JsonValue): boolean {
  if (!typedValue(slot, value)) return false;
  const rules = slot.validation;
  if (!rules) return true;
  if (
    typeof value === "number" &&
    ((rules.min !== undefined && value < rules.min) ||
      (rules.max !== undefined && value > rules.max))
  )
    return false;
  if (typeof value !== "string") return !rules.options;
  if (rules.min_length !== undefined && value.length < rules.min_length) return false;
  if (rules.max_length !== undefined && value.length > rules.max_length) return false;
  if (rules.options && !rules.options.includes(value)) return false;
  return !rules.pattern || new RegExp(rules.pattern).test(value);
}
export function applyAnswers(
  definition: ProcessDefinition,
  state: EngineState,
  answers: readonly { id: string; value: JsonValue }[],
): { state: EngineState; validationErrors: { slotId: string; message: string }[] } {
  const values = { ...state.values };
  const validationErrors: { slotId: string; message: string }[] = [];
  for (const answer of answers) {
    const slot = definition.slots.find((item) => item.id === answer.id);
    if (!slot || !validSlotValue(slot, answer.value)) {
      validationErrors.push({
        slotId: answer.id,
        message: slot ? processCopy.invalidSlot : processCopy.unknownSlot,
      });
      continue;
    }
    values[answer.id] = answer.value;
  }
  return { state: { ...state, values }, validationErrors };
}
