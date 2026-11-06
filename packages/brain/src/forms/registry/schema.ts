import { z } from "zod";
import { ViewerFieldSchema } from "../viewer/schema.ts";

/** Only presentation/ownership edits cross this boundary; fact mappings remain server-owned. */
export const ReviewedFieldSchema = ViewerFieldSchema.pick({
  id: true,
  label_de: true,
  type: true,
  owner: true,
})
  .extend({ box: ViewerFieldSchema.shape.box.unwrap() })
  .strict();
export type ReviewedField = z.infer<typeof ReviewedFieldSchema>;
export const ReviewTemplateSchema = z.strictObject({
  formInstanceId: z.uuid(),
  fields: z.array(ReviewedFieldSchema).min(1),
});
export type ReviewTemplateInput = z.infer<typeof ReviewTemplateSchema>;
