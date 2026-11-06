import { readFileSync } from "node:fs";
import { SafetyNoticeSchema } from "@lotse/protocol";
import { parse } from "yaml";
import { z } from "zod";
import { GUARD_CONFIG } from "./config.ts";

const patternSchema = z.strictObject({
  id: z.string().min(1),
  category: z.string().min(1),
  language: z.enum(["de", "en", "both"]),
  pattern: z.string().min(1),
});
const metadata = {
  version: z.string().min(1),
  as_of: z.iso.date(),
  review: z.strictObject({ status: z.string().min(1), basis: z.string().min(1) }),
  sources: z.array(z.strictObject({ url: z.string().min(1), quote: z.string().min(1) })).min(1),
};
const safetyDataSchema = z.strictObject({
  ...metadata,
  notices: z.strictObject({ de: SafetyNoticeSchema, en: SafetyNoticeSchema }),
  nonCurrent: z.array(z.string().min(1)),
  contextTerms: z.array(z.string().min(1)).min(1),
  patterns: z.array(patternSchema).min(1),
});
const boundaryDataSchema = z.strictObject({
  ...metadata,
  patterns: z.array(patternSchema).min(1),
  medicalRequests: z.array(patternSchema).min(1),
  requestPrompt: z.string().min(1),
  injectionMarkers: z.array(z.string().min(1)).min(1),
  administrativeDisclaimers: z.array(z.string().min(1)).min(1),
});
function read(location: URL): unknown {
  try {
    return parse(readFileSync(location, "utf8"));
  } catch {
    throw new Error("GUARD_DATA_UNAVAILABLE");
  }
}
function compile(patterns: z.infer<typeof patternSchema>[]) {
  return patterns.map(({ pattern, ...fields }) => ({
    ...fields,
    expression: new RegExp(pattern, "iu"),
  }));
}
// Fixed, packaged data is validated at startup; a missing file never silently disables a guard.
const safety = safetyDataSchema.parse(read(GUARD_CONFIG.dataFiles.safety));
const boundary = boundaryDataSchema.parse(read(GUARD_CONFIG.dataFiles.boundary));
export const safetyData = {
  ...safety,
  patterns: compile(safety.patterns),
  contextTerms: safety.contextTerms.map((pattern) => new RegExp(pattern, "giu")),
  nonCurrent: safety.nonCurrent.map((pattern) => new RegExp(pattern, "iu")),
};
export const boundaryData = {
  ...boundary,
  patterns: compile(boundary.patterns),
  medicalRequests: compile(boundary.medicalRequests),
  administrativeDisclaimers: boundary.administrativeDisclaimers.map(
    (pattern) => new RegExp(pattern, "iu"),
  ),
  injectionMarkers: boundary.injectionMarkers.map((pattern) => new RegExp(pattern, "iu")),
};
