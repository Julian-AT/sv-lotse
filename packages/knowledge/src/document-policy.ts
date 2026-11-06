import { z } from "zod";
import data from "../data/document-extraction.json" with { type: "json" };

const sectionKind = z.enum([
  "medication",
  "care",
  "rehabilitation",
  "insurance",
  "tasks",
  "clinical",
]);
export type DocumentSectionKind = z.infer<typeof sectionKind>;

/** Sourced headings are data; consumers implement only section traversal. */
export const documentExtractionPolicy = z
  .strictObject({
    version: z.string().min(1),
    instructions: z.string().min(1),
    metadata_pattern: z.string().min(1),
    metadata_rules: z.array(
      z.object({ pattern: z.string().min(1), kind: z.literal("issuer_name").optional() }),
    ),
    issuer_excluded_context_pattern: z.string().min(1),
    header_reference_pattern: z.string().min(1),
    header_reference_context_pattern: z.string().min(1),
    document_title_pattern: z.string().min(1),
    deduplicate_prefix_pattern: z.string().min(1),
    inline_clinical_pattern: z.string().min(1),
    administrative_field_pattern: z.string().min(1),
    table_cell_heading_pattern: z.string().min(1),
    irrelevant_source_pattern: z.string().min(1),
    navigation_recommendation_pattern: z.string().min(1),
    medication_excluded_quote_pattern: z.string().min(1),
    row_value_pattern: z.string().min(1),
    clinical_exclusions: z.array(z.object({ section: sectionKind, pattern: z.string().min(1) })),
    administrative_sentence_pattern: z.string().min(1),
    supporting_sources: z.array(z.object({ uri: z.string(), quotes: z.array(z.string()) })),
    table_header_pattern: z.string().min(1),
    vaccination_start_pattern: z.string().min(1),
    vaccination_end_pattern: z.string().min(1),
    sentence_abbreviations: z.array(z.string().min(1)),
    source: z.strictObject({ uri: z.string(), as_of: z.iso.date(), quotes: z.array(z.string()) }),
    sections: z.array(z.strictObject({ kind: sectionKind, pattern: z.string().min(1) })),
  })
  .parse(data);
