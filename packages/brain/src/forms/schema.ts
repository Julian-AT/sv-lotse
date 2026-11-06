import type { formTemplates } from "@lotse/db/schema";
import { z } from "zod";
import { contracts, type ToolName } from "../tools/contracts/index.ts";

export const FormSchema = contracts["form.getSchema"].output;
export type FormSchema = z.infer<typeof FormSchema>;
export type FormField = FormSchema["fields"][number];
export type FormToolResult<Name extends ToolName> = z.infer<(typeof contracts)[Name]["output"]>;
export type Template = typeof formTemplates.$inferSelect;
export const ValidationSchema = z.object({
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  min_length: z.number().int().nonnegative().optional(),
  max_length: z.number().int().nonnegative().optional(),
  pattern: z.string().optional(),
  options: z.array(z.string()).optional(),
});
const StoredSchema = z.object({ fields: z.array(z.record(z.string(), z.json())) });

/** Accept both catalog schemas and detector drafts, preserving the public tool contract. */
export function templateSchema(template: Template): FormSchema {
  const stored = StoredSchema.parse(template.schema);
  const schema = FormSchema.parse({
    templateId: template.id,
    status: template.status,
    fields: stored.fields.map((field) => ({
      ...field,
      page:
        field.page ??
        (typeof field.box === "object" && field.box && !Array.isArray(field.box)
          ? field.box.page
          : 1),
      method: field.method ?? (field.acro_field ? "acroform" : "vector"),
      confidence: field.confidence ?? 1,
      validation: field.validation ?? {},
      fact_type: field.fact_type ?? `form.field.${template.id}.${field.id}`,
    })),
  });
  const restricted = new Map(
    schema.fields
      .filter(
        (field) =>
          field.acro_field &&
          (field.owner !== "applicant" || field.signature !== "none" || field.type === "signature"),
      )
      .map((field) => [field.acro_field, field]),
  );
  const ids = new Set<string>();
  for (const field of schema.fields) {
    if (ids.has(field.id) || field.page > template.pages) throw new FormError("invalid_fields");
    ids.add(field.id);
    const owner = restricted.get(field.acro_field);
    // A native AcroForm value is shared by all its widgets, including provider copies. The insured
    // person's insurance number is identity data, not a provider entry, so the applicant keeps it.
    if (owner && !(field.owner === "applicant" && INSURANCE_NUMBER.test(field.label_de))) {
      field.owner = owner.owner;
      field.signature = owner.type === "signature" ? "subject" : owner.signature;
    }
  }
  return schema;
}

export class FormError extends Error {
  constructor(
    readonly code:
      | "access_denied"
      | "not_found"
      | "invalid_fields"
      | "approval_required"
      | "origin_denied"
      | "download_failed"
      | "unsupported_format"
      | "asset_mismatch"
      | "action_writer_required",
  ) {
    super(`FORM_${code.toUpperCase()}`);
    this.name = "FormError";
  }
}

export const INSURANCE_NUMBER = /versicherungsnummer|\bvsnr/iu;
