import { IdSchema, UriSchema } from "@lotse/protocol";
import { z } from "zod";

// Transport shape of PRD section 10. The knowledge loader additionally validates
// condition syntax, references and source review; the runtime never evaluates
// catalog expressions. Keep this boundary independent of knowledge's current
// compatibility dependency on brain.
const text = z.string().min(1);
const source = z.strictObject({
  url: UriSchema,
  quote: text,
  retrieved_at: z.iso.datetime({ offset: true }),
});
const date = z.iso.date();
const carrier = z.enum(["oegk", "svs", "bvaeb", "pva", "auva"]);
export const benefitRecordSchema = z.strictObject({
  id: IdSchema,
  name_de: text,
  name_simple: text,
  area: z.enum(["A", "B", "C", "D", "E", "F"]),
  life_situations: z.array(text),
  scope: z.enum(["social_insurance", "federal", "state", "municipality", "other"]),
  criteria: z.array(
    z.strictObject({
      id: IdSchema,
      text_de: text,
      condition: text.optional(),
      legal_basis: text.optional(),
      source,
    }),
  ),
  target_group: z
    .strictObject({
      age_min: z.number().nonnegative().optional(),
      age_max: z.number().nonnegative().optional(),
      sex: z.enum(["female", "male", "diverse", "all"]).optional(),
      interval: text.optional(),
      family_history_criteria: z.array(text).optional(),
      rationale_text: text,
      rationale_source: source,
    })
    .optional(),
  carriers: z.array(carrier),
  office_rules: z.array(z.strictObject({ when: text, office: text })),
  documents: z.array(
    z.strictObject({
      id: IdSchema,
      name_de: text,
      required: z.boolean(),
      obtain_from: text,
      source,
    }),
  ),
  forms: z.array(z.union([text, z.strictObject({ search: text, publisher: text })])),
  process: text,
  appointment_channels: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("online"), url: UriSchema, verified_at: date }),
      z.strictObject({ kind: z.literal("phone"), number: text, verified_at: date }),
      z.strictObject({ kind: z.literal("email"), url: UriSchema, verified_at: date }),
    ]),
  ),
  sources: z.array(source),
  as_of: date,
  verified_at: date,
});
