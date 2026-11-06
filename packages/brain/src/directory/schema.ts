import { z } from "zod";
import { benefitRecordSchema } from "../tools/contracts/records.ts";

// Knowledge permits sourced records awaiting human review. Routing must not
// invent a review date to satisfy the older catalog transport contract.
export const directoryBenefitSchema = benefitRecordSchema.partial({ verified_at: true });

export const locationSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const timeWindowSchema = z
  .strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((value) => Date.parse(value.to) > Date.parse(value.from), "Invalid time window");
const text = z.string().min(1);
export const directoryRecordSchema = z.object({
  id: text,
  name_de: text,
  type: text.optional(),
  remote: z.boolean().optional(),
  region: text.optional(),
  address: z
    .strictObject({ street: text, postal_code: text, locality: text, country: z.literal("AT") })
    .optional(),
  location: z
    .strictObject({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
  phone: text.optional(),
  email: z.email().optional(),
  url: z.url({ protocol: /^https?$/ }).optional(),
  appointment_channels: z.array(z.url({ protocol: /^https?$/ })).optional(),
  opening_hours: z.union([text, z.record(z.string(), text)]).optional(),
  languages: z.array(text).optional(),
  accessibility: text.optional(),
  accessibility_features: z.array(text).optional(),
  services: z.array(text).optional(),
  carriers: z.array(text).optional(),
  sources: z
    .array(
      z.strictObject({
        url: z.url({ protocol: /^https?$/ }),
        quote: text,
        retrieved_at: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1),
  as_of: z.iso.date(),
});

export type DirectoryRecord = z.infer<typeof directoryRecordSchema>;
export type Location = z.infer<typeof locationSchema>;
export type TimeWindow = z.infer<typeof timeWindowSchema>;

export class DirectoryError extends Error {
  constructor(
    readonly code:
      | "BENEFIT_NOT_FOUND"
      | "OFFICE_NOT_FOUND"
      | "OFFICE_CONTEXT_REQUIRED"
      | "PLACE_NOT_FOUND"
      | "PLACE_AMBIGUOUS"
      | "APPOINTMENT_NOT_FOUND"
      | "CASE_ACCESS_DENIED"
      | "FACT_ACCESS_DENIED",
  ) {
    super(code);
    this.name = "DirectoryError";
  }
}
