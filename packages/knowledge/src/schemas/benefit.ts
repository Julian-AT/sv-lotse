import { z } from "zod";
import {
  CarrierSchema,
  DateSchema,
  HttpUrl,
  Id,
  provenance,
  reference,
  SourceRefSchema,
  Text,
} from "./common.ts";
import { ConditionSchema } from "./condition.ts";
export const BenefitSchema = z.strictObject({
  id: Id,
  name_de: Text,
  name_simple: Text,
  area: z.enum(["A", "B", "C", "D", "E", "F"]),
  life_situations: z.array(Id),
  scope: z.enum(["social_insurance", "federal", "state", "municipality", "other"]),
  criteria: z
    .array(
      z.strictObject({
        id: Id,
        text_de: Text,
        condition: ConditionSchema.optional(),
        legal_basis: Text.optional(),
        source: SourceRefSchema,
      }),
    )
    .min(1),
  target_group: z
    .strictObject({
      age_min: z.number().nonnegative().optional(),
      age_max: z.number().nonnegative().optional(),
      sex: z.enum(["female", "male", "diverse", "all"]).optional(),
      interval: Text.optional(),
      family_history_criteria: z.array(Text).optional(),
      rationale_text: Text,
      rationale_source: SourceRefSchema,
    })
    .optional(),
  carriers: z.array(CarrierSchema),
  office_rules: z
    .array(z.strictObject({ when: ConditionSchema, office: reference("offices") }))
    .min(1),
  documents: z.array(
    z.strictObject({
      id: Id,
      name_de: Text,
      required: z.boolean(),
      obtain_from: Text,
      source: SourceRefSchema,
    }),
  ),
  forms: z.array(z.union([reference("forms"), z.strictObject({ search: Text, publisher: Text })])),
  process: reference("processes"),
  appointment_channels: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("online"), url: HttpUrl, verified_at: DateSchema }),
      z.strictObject({ kind: z.literal("phone"), number: Text, verified_at: DateSchema }),
      z.strictObject({
        kind: z.literal("email"),
        url: z.url({ protocol: /^mailto$/ }),
        verified_at: DateSchema,
      }),
    ]),
  ),
  ...provenance,
});
export type Benefit = z.infer<typeof BenefitSchema>;
