import { z } from "zod";
import { Id, provenance, reference, Text, ValidationSchema } from "./common.ts";
import { ConditionSchema } from "./condition.ts";
export const ProcessSchema = z
  .strictObject({
    id: Id,
    benefit: reference("catalog"),
    actor_roles: z.array(z.enum(["subject", "helper"])).min(1),
    slots: z.array(
      z.strictObject({
        id: Id,
        type: z.string().regex(/^(boolean|string|date|number|enum:[\w.-]+|fact:[\w.-]+)$/),
        from_context: Text.optional(),
        question_hint: Text,
        validation: ValidationSchema.optional(),
      }),
    ),
    steps: z
      .array(
        z.strictObject({
          id: Id,
          needs: z.array(Id),
          criteria: reference("catalog", "criteria").optional(),
          documents: reference("catalog", "documents").optional(),
          form: reference("forms").optional(),
          action: Text.optional(),
          signature: z.enum(["subject", "none"]).optional(),
          on_complete: z.array(Text).optional(),
          transitions: z
            .array(z.strictObject({ to: Id, when: ConditionSchema.optional() }))
            .optional(),
          outputs: z.array(z.strictObject({ id: Id, type: Text })).optional(),
          reminders: z
            .array(
              z.strictObject({
                after_days: z.number().int().nonnegative(),
                text_de: Text,
                when: ConditionSchema.optional(),
              }),
            )
            .optional(),
        }),
      )
      .min(1),
    completion: z.strictObject({
      evidence: z.array(z.enum(["user_statement", "artefact_built", "document_present"])).min(1),
    }),
    ...provenance,
  })
  .superRefine((process, context) => {
    const ids = new Set<string>();
    for (const [collection, entries] of [
      ["slots", process.slots],
      ["steps", process.steps],
    ] as const) {
      entries.forEach((entry, index) => {
        if (ids.has(entry.id))
          context.addIssue({
            code: "custom",
            path: [collection, index, "id"],
            message: "Duplicate slot or step id",
          });
        ids.add(entry.id);
      });
    }
    const steps = new Set(process.steps.map((step) => step.id));
    process.steps.forEach((step, index) => {
      step.needs.forEach((id, dependency) => {
        if (!ids.has(id) || id === step.id)
          context.addIssue({
            code: "custom",
            path: ["steps", index, "needs", dependency],
            message: "Unknown or self dependency",
          });
      });
      step.transitions?.forEach((transition, transitionIndex) => {
        if (!steps.has(transition.to))
          context.addIssue({
            code: "custom",
            path: ["steps", index, "transitions", transitionIndex, "to"],
            message: "Unknown target step",
          });
      });
    });
  });
export type Process = z.infer<typeof ProcessSchema>;
