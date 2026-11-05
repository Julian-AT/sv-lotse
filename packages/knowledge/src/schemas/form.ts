import { z } from "zod";
import { Id, Text, ValidationSchema, verifiedProvenance } from "./common.ts";
export const FormFieldSchema = z
  .strictObject({
    id: Id,
    label_de: Text,
    labels: z.record(Text, Text),
    help_text: Text,
    type: z.enum(["text", "date", "number", "checkbox", "choice", "signature"]),
    validation: ValidationSchema,
    fact_type: Text,
    acro_field: Text.optional(),
    box: z
      .strictObject({
        page: z.number().int().positive(),
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .optional(),
    owner: z.enum(["applicant", "doctor", "hospital", "office"]),
    signature: z.enum(["subject", "none"]),
  })
  .refine((field) => (field.acro_field !== undefined) !== (field.box !== undefined), {
    path: ["acro_field"],
    message: "Provide exactly one of acro_field or box",
  });
export const FormSchema = z
  .strictObject({
    id: Id,
    template_id: z.uuid(),
    status: z.literal("verified"),
    fields: z.array(FormFieldSchema).min(1),
    ...verifiedProvenance,
  })
  .superRefine((form, context) => {
    const ids = new Set<string>();
    form.fields.forEach((field, index) => {
      if (ids.has(field.id))
        context.addIssue({
          code: "custom",
          path: ["fields", index, "id"],
          message: "Duplicate field id",
        });
      ids.add(field.id);
    });
  });
export type FormSchema = z.infer<typeof FormSchema>;
