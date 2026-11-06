import { z } from "zod";
import { workspaceSourceSchema } from "./schema.ts";

export const checklistBenefitRecord = z.object({
  id: z.string(),
  name_de: z.string(),
  documents: z.array(
    z.object({
      id: z.string(),
      name_de: z.string(),
      required: z.boolean(),
      obtain_from: z.string(),
      source: workspaceSourceSchema,
    }),
  ),
});
export const workspaceProcessRecord = z.object({
  id: z.string(),
  benefit: z.string(),
  steps: z.array(z.object({ id: z.string(), action: z.string().optional() })),
});
export const directoryRecord = z.object({
  id: z.string(),
  name_de: z.string(),
  type: z.string(),
  region: z.string().optional(),
  address: z
    .object({ street: z.string(), postal_code: z.string(), locality: z.string() })
    .optional(),
  location: z
    .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
    .optional(),
  opening_hours: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
  phone: z.string().optional(),
  email: z.email().optional(),
  url: z.url({ protocol: /^https?$/ }).optional(),
  appointment_channels: z.array(z.url({ protocol: /^https?$/ })).optional(),
  accessibility: z.string().optional(),
  services: z.array(z.string()).optional(),
  sources: z.array(workspaceSourceSchema).min(1),
  as_of: z.iso.date(),
});
