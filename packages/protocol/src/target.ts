import { z } from "zod";
import {
  IdSchema,
  IndexSchema,
  PageNumberSchema,
  UnitIntervalSchema,
  UriSchema,
} from "./shared.ts";

export const TargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ui"), elementId: IdSchema }),
  z.strictObject({ kind: z.literal("form"), formInstanceId: IdSchema, fieldId: IdSchema }),
  z.strictObject({ kind: z.literal("dom"), handle: IdSchema, url: UriSchema }),
  z.strictObject({
    kind: z.literal("ax"),
    role: z.string().min(1),
    label: z.string(),
    path: z.array(z.string()),
    appBundleId: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("text"),
    quote: z.string().min(1),
    documentId: IdSchema.optional(),
    page: PageNumberSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("point"),
    x: UnitIntervalSchema,
    y: UnitIntervalSchema,
    screenIndex: IndexSchema,
    confidence: UnitIntervalSchema,
  }),
]);
export type Target = z.infer<typeof TargetSchema>;
