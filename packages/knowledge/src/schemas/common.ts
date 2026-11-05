import { z } from "zod";
export const Text = z.string().refine((value) => value.trim().length > 0, "Must not be blank");
export const Id = z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/);
export const DateSchema = z.iso.date();
export const HttpUrl = z.url({ protocol: /^https?$/ });
export const SourceRefSchema = z.strictObject({
  url: HttpUrl,
  quote: Text,
  retrieved_at: z.iso.datetime({ offset: true }),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const provenance = {
  sources: z.array(SourceRefSchema).min(1),
  as_of: DateSchema,
  verified_at: DateSchema.optional(),
};
export const verifiedProvenance = { ...provenance, verified_at: DateSchema };
export const CarrierSchema = z.enum(["oegk", "svs", "bvaeb", "pva", "auva"]);
export const referencePattern =
  /^ref:(catalog|processes|offices|facilities|forms)\/([a-z0-9][a-z0-9_.-]*)(?:#([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*|\.\d+)*))?$/;
export const ReferenceSchema = z
  .string()
  .regex(referencePattern, "Expected ref:<kind>/<id>[#path]");
export function reference(kind: string, fragment?: string) {
  return ReferenceSchema.refine(
    (value) => {
      const match = referencePattern.exec(value);
      return match?.[1] === kind && (fragment ? match[3] === fragment : match[3] === undefined);
    },
    `Expected ref:${kind}/<id>${fragment ? `#${fragment}` : ""}`,
  );
}
export const ValidationSchema = z.strictObject({
  required: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  min_length: z.number().int().nonnegative().optional(),
  max_length: z.number().int().nonnegative().optional(),
  pattern: Text.refine((value) => {
    try {
      new RegExp(value);
      return true;
    } catch {
      return false;
    }
  }, "Invalid regular expression").optional(),
  options: z.array(Text).min(1).optional(),
});
export const SourceRegistrySchema = z.strictObject(provenance);
export const AllowlistSchema = z.strictObject({
  origins: z
    .array(
      z.strictObject({
        origin: HttpUrl.refine(
          (value) => new URL(value).origin === value,
          "Expected an origin without path or credentials",
        ),
        purpose: Text,
      }),
    )
    .min(1),
  ...provenance,
});
export type Allowlist = z.infer<typeof AllowlistSchema>;
