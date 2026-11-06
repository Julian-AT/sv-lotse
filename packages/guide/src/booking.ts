import { ProvenanceSchema, TargetSchema } from "@lotse/protocol";
import { z } from "zod";

// Same frozen ui.fill input; validation stays local to the browser package.
export const bookingFillSchema = z.strictObject({
  target: TargetSchema,
  value: z.string(),
  provenance: ProvenanceSchema,
});

export const bookingConfiguration = {
  autonomyLevel: z.enum(["L1", "L2", "L3"]),
  bookingPages: z.array(z.url({ protocol: /^https?$/ })),
};
