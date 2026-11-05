import { z } from "zod";

/** Points in the displayed CropBox at scale 1; origin top-left, pages one-based. */
export const FieldBoxSchema = z.object({
  page: z.number().int().positive(),
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export const FieldTypeSchema = z.enum([
  "text",
  "date",
  "number",
  "checkbox",
  "choice",
  "signature",
]);
export const FieldOwnerSchema = z.enum(["applicant", "doctor", "hospital", "office"]);
export const DetectionMethodSchema = z.enum(["acroform", "vector", "text", "vision"]);
export const DetectedFieldSchema = z.object({
  id: z.string().min(1),
  label_de: z.string().min(1),
  type: FieldTypeSchema,
  box: FieldBoxSchema,
  acro_field: z.string().optional(),
  owner: FieldOwnerSchema,
  signature: z.enum(["subject", "none"]),
  confidence: z.number().min(0).max(1),
  method: DetectionMethodSchema,
});
export const DraftFormSchema = z
  .object({
    status: z.literal("auto"),
    pages: z
      .array(
        z.object({
          page: z.number().int().positive(),
          width: z.number().positive(),
          height: z.number().positive(),
        }),
      )
      .min(1),
    fields: z.array(DetectedFieldSchema),
  })
  .superRefine((draft, context) => {
    const ids = new Set<string>();
    for (const field of draft.fields) {
      const page = draft.pages.find((item) => item.page === field.box.page);
      if (
        ids.has(field.id) ||
        !page ||
        field.box.x + field.box.width > page.width + 0.01 ||
        field.box.y + field.box.height > page.height + 0.01
      ) {
        context.addIssue({ code: "custom", message: "Invalid field identity or page bounds" });
      }
      ids.add(field.id);
    }
  });
export type FieldBox = z.infer<typeof FieldBoxSchema>;
export type FieldType = z.infer<typeof FieldTypeSchema>;
export type FieldOwner = z.infer<typeof FieldOwnerSchema>;
export type DetectedField = z.infer<typeof DetectedFieldSchema>;
export type DraftForm = z.infer<typeof DraftFormSchema>;

export class FieldDetectionError extends Error {
  readonly code: "invalid_pdf" | "render_unavailable" | "vision_failed" | "limits_exceeded";
  constructor(code: FieldDetectionError["code"]) {
    super(`Form field detection failed: ${code}`);
    this.name = "FieldDetectionError";
    this.code = code;
  }
}
