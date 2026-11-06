import { documentExtractionPolicy } from "@lotse/knowledge/document-policy";

const rules = documentExtractionPolicy.metadata_rules.map(({ pattern, kind }) => ({
  kind,
  expression: new RegExp(pattern, "giu"),
}));
const issuerExcludedContext = new RegExp(
  documentExtractionPolicy.issuer_excluded_context_pattern,
  "iu",
);
const reference = new RegExp(documentExtractionPolicy.header_reference_pattern, "gu");
const referenceContext = new RegExp(
  documentExtractionPolicy.header_reference_context_pattern,
  "iu",
);
export const documentTitle = new RegExp(documentExtractionPolicy.document_title_pattern, "iu");
export const inlineClinical = new RegExp(documentExtractionPolicy.inline_clinical_pattern, "iu");
export const irrelevantSource = new RegExp(
  documentExtractionPolicy.irrelevant_source_pattern,
  "iu",
);
export const navigationRecommendation = new RegExp(
  documentExtractionPolicy.navigation_recommendation_pattern,
  "iu",
);
export const medicationExcludedQuote = new RegExp(
  documentExtractionPolicy.medication_excluded_quote_pattern,
  "iu",
);
export const administrativeField = new RegExp(
  documentExtractionPolicy.administrative_field_pattern,
  "iu",
);
export const deduplicatePrefix = new RegExp(
  documentExtractionPolicy.deduplicate_prefix_pattern,
  "iu",
);
export const rowValuePrefix = new RegExp(documentExtractionPolicy.row_value_pattern, "iu");
export const administrativeSentence = new RegExp(
  documentExtractionPolicy.administrative_sentence_pattern,
  "iu",
);
export const clinicalExclusions = documentExtractionPolicy.clinical_exclusions.map(
  ({ section, pattern }) => ({ section, expression: new RegExp(pattern, "iu") }),
);

export interface MetadataSpan {
  start: number;
  end: number;
}
/** Only explicit labels and issuer/reference syntax; no clinical values are inferred. */
export function metadataSpans(text: string, firstPage: boolean): MetadataSpan[] {
  const spans = rules.flatMap((rule) =>
    rule.kind === "issuer_name" && issuerExcludedContext.test(text)
      ? []
      : [...text.matchAll(rule.expression)].map((match) => {
          const value = (match.groups?.value ?? match[0]).trim();
          const start = match.index + match[0].indexOf(value);
          return { start, end: start + value.length };
        }),
  );
  if (firstPage && !text.includes(":") && referenceContext.test(text))
    spans.push(
      ...[...text.matchAll(reference)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
      })),
    );
  return spans.filter(
    (span, index) =>
      !spans.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.start <= span.start &&
          other.end >= span.end &&
          (other.end - other.start > span.end - span.start || otherIndex < index),
      ),
  );
}
