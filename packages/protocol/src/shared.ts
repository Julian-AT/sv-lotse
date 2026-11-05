import { z } from "zod";

export const PROTOCOL_VERSION = "1.0.0" as const;

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

// URI syntax, rather than WHATWG URL parsing: do not encode or normalize input.
// Match ajv-formats' full `uri` format, including IP literals and opaque URIs.
// Grammar: https://www.rfc-editor.org/rfc/rfc3986#appendix-A
const uriCharacter = "(?:[a-z0-9._~!$&'()*+,;=\\-]|%[0-9a-f]{2})";
const pathCharacter = "(?:[a-z0-9._~!$&'()*+,;=:@\\-]|%[0-9a-f]{2})";
const queryCharacter = "(?:[a-z0-9._~!$&'()*+,;=:@/?\\-]|%[0-9a-f]{2})";
const octet = "(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)";
const ipv4 = `(?:${octet}\\.){3}${octet}`;
const h16 = "[0-9a-f]{1,4}";
const ls32 = `(?:${h16}:${h16}|${ipv4})`;
const ipv6 = [
  `(?:${h16}:){6}${ls32}`,
  `::(?:${h16}:){5}${ls32}`,
  `(?:${h16})?::(?:${h16}:){4}${ls32}`,
  ...[1, 2, 3, 4].map(
    (count) => `(?:(?:${h16}:){0,${count}}${h16})?::(?:${h16}:){${4 - count}}${ls32}`,
  ),
  `(?:(?:${h16}:){0,5}${h16})?::${h16}`,
  `(?:(?:${h16}:){0,6}${h16})?::`,
].join("|");
const ipLiteral = `\\[(?:${ipv6}|v[0-9a-f]+\\.[a-z0-9._~!$&'()*+,;=:\\-]+)\\]`;
// ajv-formats also accepts a single slash before an authority.
const authority = `\\/?\\/(?:(?:${uriCharacter}|:)*@)?(?:${ipLiteral}|${ipv4}|${uriCharacter}*)(?::[0-9]*)?`;
const pathSuffix = `(?:/${pathCharacter}*)*`;
const nonemptyPath = `${pathCharacter}+${pathSuffix}`;
const hierarchy = `(?:${authority}${pathSuffix}|/(?:${nonemptyPath})?|${nonemptyPath})`;
const uriPattern = new RegExp(
  `^[a-z][a-z0-9+.\\-]*:${hierarchy}(?:\\?${queryCharacter}*)?(?:#${queryCharacter}*)?$`,
  "i",
);
export const UriSchema = z.stringFormat("uri", (value) => uriPattern.test(value));
export type Uri = z.infer<typeof UriSchema>;

export const IsoTimestampSchema = z.iso.datetime({ offset: true });
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;
export const LanguageTagSchema = z.string().regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
export type LanguageTag = z.infer<typeof LanguageTagSchema>;
export const SemverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
export const UnitIntervalSchema = z.number().min(0).max(1);
export const IndexSchema = z.int().nonnegative();
export const PageNumberSchema = z.int().positive();
// Source-image/page coordinates. TargetRect uses window points instead.
export const BoundingBoxSchema = z.strictObject({
  x: UnitIntervalSchema,
  y: UnitIntervalSchema,
  width: UnitIntervalSchema,
  height: UnitIntervalSchema,
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export const WindowRectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type WindowRect = z.infer<typeof WindowRectSchema>;

export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const CapabilitiesSchema = z.strictObject({
  overlay: z.boolean(),
  accessibility: z.boolean(),
  ocr: z.boolean(),
  onDeviceModel: z.boolean(),
  onDeviceContextSize: IndexSchema,
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const FactSourceSchema = z.strictObject({
  kind: z.enum(["document", "statement"]),
  documentId: IdSchema.optional(),
  page: PageNumberSchema.optional(),
  bbox: BoundingBoxSchema.optional(),
  quote: z.string().optional(),
  turnId: IdSchema.optional(),
});
export type FactSource = z.infer<typeof FactSourceSchema>;
// A field cites a confirmed fact or a user statement, including the source quote.
export const ProvenanceSchema = z.strictObject({
  factId: IdSchema.optional(),
  source: FactSourceSchema,
});
export type Provenance = z.infer<typeof ProvenanceSchema>;
