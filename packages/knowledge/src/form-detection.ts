import { z } from "zod";
import rules from "../data/form-detection.json" with { type: "json" };

/** Source-backed printed form vocabulary; never keyed by document or template identity. */
export const formDetectionVocabulary = z
  .object({
    as_of: z.iso.date(),
    sources: z.array(z.object({ url: z.url(), quote: z.string().min(1) })).min(1),
    contextualOptions: z.array(z.string()),
    labelRules: z.array(z.object({ pattern: z.string(), replacement: z.string() })),
    checkboxRules: z.array(z.object({ pattern: z.string(), replacement: z.string() })),
    inputRules: z.array(z.object({ pattern: z.string(), replacement: z.string() })),
    ignoredLabels: z.array(z.string()),
    contextRules: z.array(
      z.object({
        pattern: z.string(),
        replacement: z.string(),
        labels: z.array(z.string()),
        distance: z.number().positive(),
      }),
    ),
    owners: z.array(
      z.object({
        owner: z.enum(["applicant", "doctor", "hospital", "office"]),
        patterns: z.array(z.string()),
      }),
    ),
  })
  .parse(rules);
