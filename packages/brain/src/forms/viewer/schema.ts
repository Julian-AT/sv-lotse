import { ProvenanceSchema } from "@lotse/protocol";
import { z } from "zod";

/** Template boxes are displayed CropBox points, top-left origin, one-based pages. */
export const ViewerFieldSchema = z.object({
  id: z.string().min(1),
  label_de: z.string().min(1),
  labels: z.record(z.string(), z.string()).default({}),
  type: z.enum(["text", "date", "number", "checkbox", "choice", "signature"]),
  owner: z.enum(["applicant", "doctor", "hospital", "office"]),
  signature: z.enum(["subject", "none"]),
  fact_type: z.string().optional(),
  acro_field: z.string().optional(),
  box: z
    .object({
      page: z.int().positive(),
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  validation: z
    .object({
      required: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      min_length: z.int().nonnegative().optional(),
      max_length: z.int().nonnegative().optional(),
      pattern: z.string().optional(),
      options: z.array(z.string()).optional(),
    })
    .default({}),
});
export type ViewerField = z.infer<typeof ViewerFieldSchema>;
export const ViewerValueSchema = z
  .object({
    value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    provenance: ProvenanceSchema,
    state: z.enum(["draft", "confirmed"]),
    approvalId: z.string().min(1).nullable(),
  })
  .refine((field) => field.state !== "confirmed" || field.approvalId !== null);
export const ViewerInstanceSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  subjectId: z.uuid(),
  templateId: z.uuid(),
  title: z.string(),
  schema: z.object({ fields: z.array(ViewerFieldSchema) }),
  fields: z.record(z.string(), ViewerValueSchema),
});
export type ViewerInstance = z.infer<typeof ViewerInstanceSchema>;
export type ViewerValue = z.infer<typeof ViewerValueSchema>;
export const FieldCorrectionSchema = z.strictObject({
  fieldId: z.string().min(1),
  value: z.union([z.string(), z.number().finite(), z.boolean()]),
});
export type FieldCorrection = z.infer<typeof FieldCorrectionSchema>;

export function isEditableField(field: ViewerField): boolean {
  return field.owner === "applicant" && field.signature === "none" && field.type !== "signature";
}

/** Validation rules are supplied by the registry, never inferred by the viewer. */
export function isValidFieldValue(field: ViewerField, value: FieldCorrection["value"]): boolean {
  if (!isEditableField(field)) return false;
  const rules = field.validation;
  if (field.type === "checkbox") return typeof value === "boolean" && (!rules.required || value);
  if (typeof value === "boolean") return false;
  const text = String(value);
  if (text === "") return rules.required !== true;
  if (rules.min_length !== undefined && text.length < rules.min_length) return false;
  if (rules.max_length !== undefined && text.length > rules.max_length) return false;
  if (field.type === "date" && !z.iso.date().safeParse(text).success) return false;
  if (field.type === "number") {
    const number = Number(text);
    if (!Number.isFinite(number)) return false;
    if (rules.min !== undefined && number < rules.min) return false;
    if (rules.max !== undefined && number > rules.max) return false;
  }
  if (rules.options && !rules.options.includes(text)) return false;
  return !rules.pattern || new RegExp(rules.pattern).test(text);
}
