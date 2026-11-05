import { z } from "zod";
import { CarrierSchema, HttpUrl, Id, provenance, reference, Text } from "./common.ts";

const address = z.strictObject({
  street: Text,
  postal_code: Text,
  locality: Text,
  country: z.literal("AT"),
});
const directoryFields = {
  id: Id,
  name_de: Text,
  address: address.optional(),
  region: Text.optional(),
  phone: Text.optional(),
  email: z.email().optional(),
  url: HttpUrl.optional(),
  location: z
    .strictObject({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional(),
  appointment_channels: z.array(HttpUrl).optional(),
  accessibility: Text.optional(),
  ...provenance,
};
export const OfficeSchema = z.strictObject({
  ...directoryFields,
  name_simple: Text.optional(),
  opening_hours: z
    .strictObject({
      monday: Text.optional(),
      tuesday: Text.optional(),
      wednesday: Text.optional(),
      thursday: Text.optional(),
      friday: Text.optional(),
      saturday: Text.optional(),
      sunday: Text.optional(),
      notes: Text.optional(),
    })
    .optional(),
  carrier: CarrierSchema.optional(),
  jurisdiction: Text.optional(),
});
export const FacilitySchema = z.strictObject({
  ...directoryFields,
  type: Text,
  services: z.array(Text).optional(),
  carriers: z.array(CarrierSchema).optional(),
  office: reference("offices").optional(),
});
export type Office = z.infer<typeof OfficeSchema>;
export type Facility = z.infer<typeof FacilitySchema>;
