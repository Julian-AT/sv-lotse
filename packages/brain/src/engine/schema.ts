import { z } from "zod";

const text = z.string().min(1);
const value = z.json();
export const processDefinitionSchema = z.object({
  id: text,
  benefit: text,
  actor_roles: z.array(z.enum(["subject", "helper"])),
  slots: z.array(
    z.object({
      id: text,
      type: z.string().regex(/^(boolean|string|date|number|enum:[\w.-]+|fact:[\w.-]+)$/),
      from_context: text.optional(),
      question_hint: text,
      validation: z
        .object({
          required: z.boolean().optional(),
          min: z.number().optional(),
          max: z.number().optional(),
          min_length: z.number().optional(),
          max_length: z.number().optional(),
          pattern: text.optional(),
          options: z.array(text).optional(),
        })
        .optional(),
    }),
  ),
  steps: z
    .array(
      z.object({
        id: text,
        needs: z.array(text),
        criteria: text.optional(),
        documents: text.optional(),
        form: text.optional(),
        action: text.optional(),
        signature: z.enum(["subject", "none"]).optional(),
        on_complete: z.array(text).optional(),
        transitions: z.array(z.object({ to: text, when: text.optional() })).optional(),
        outputs: z.array(z.object({ id: text, type: text })).optional(),
        reminders: z
          .array(
            z.object({
              after_days: z.number().int().nonnegative(),
              text_de: text,
              when: text.optional(),
            }),
          )
          .optional(),
      }),
    )
    .min(1),
  completion: z.object({
    evidence: z.array(z.enum(["user_statement", "artefact_built", "document_present"])),
  }),
  sources: z
    .array(z.object({ url: z.url(), quote: text, retrieved_at: z.iso.datetime({ offset: true }) }))
    .min(1),
  as_of: z.iso.date(),
});
export type ProcessDefinition = z.infer<typeof processDefinitionSchema>;
export type SlotDefinition = ProcessDefinition["slots"][number];
export type StepDefinition = ProcessDefinition["steps"][number];
export type JsonValue = z.infer<typeof value>;
/**
 * Process action for the goal confirmation the turn pipeline performs before `process.start`
 * (FR-G7). It is not a tool: the engine completes such steps from the confirmed goal.
 */
export const GOAL_CONFIRMATION_ACTION = "goal.confirm";
export const engineStateSchema = z.object({
  processId: text,
  goal: text,
  values: z.record(text, value),
  asked: z.array(text),
  completed: z.array(text),
  activated: z.array(text),
  transitioned: z.array(text).default([]),
});
export type EngineState = z.infer<typeof engineStateSchema>;
export class ProcessError extends Error {
  constructor(
    readonly code:
      | "ACCESS_DENIED"
      | "GOAL_CONFIRMATION_REQUIRED"
      | "PROCESS_NOT_FOUND"
      | "PROCESS_NOT_STARTED"
      | "INVALID_DEFINITION"
      | "STEP_NOT_READY"
      | "INVALID_EVIDENCE"
      | "TURN_REQUIRED"
      | "BENEFIT_NOT_FOUND",
  ) {
    super(code);
    this.name = "ProcessError";
  }
}
