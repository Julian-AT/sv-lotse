import { generateText, Output } from "ai";
import type { z } from "zod";
import { modelFor } from "../models/index.ts";
import { type SourceCandidate, selectionSchema, statementCandidates } from "./candidates.ts";
import { DOCUMENT_MAX_OUTPUT_TOKENS, DOCUMENT_MODEL_TIMEOUT_MS } from "./config.ts";
import { DOCUMENT_EXTRACTION_INSTRUCTIONS } from "./copy.ts";
import { locateQuote, sourceQuote } from "./grounding.ts";
import {
  administrativeField,
  administrativeSentence,
  clinicalExclusions,
  deduplicatePrefix,
  documentTitle,
  inlineClinical,
  irrelevantSource,
  medicationExcludedQuote,
  navigationRecommendation,
} from "./metadata.ts";
import {
  DocumentError,
  type DocumentPage,
  type DocumentStatement,
  statementSchema,
} from "./schema.ts";
import { documentSections, type SectionedPage } from "./sections.ts";

export { groundStatements, locateQuote } from "./grounding.ts";

type Selection = z.infer<typeof selectionSchema>["statements"][number];
function eligible(candidate: SourceCandidate): boolean {
  if (
    documentTitle.test(candidate.text) ||
    inlineClinical.test(candidate.text) ||
    irrelevantSource.test(candidate.text)
  )
    return false;
  if (
    clinicalExclusions.some(
      ({ section, expression }) => candidate.section === section && expression.test(candidate.text),
    )
  )
    return false;
  if (
    candidate.kind === "field" &&
    !candidate.fixed &&
    candidate.section === "unclassified" &&
    !administrativeField.test(candidate.text)
  )
    return false;
  return (
    candidate.kind !== "field" ||
    candidate.fixed === true ||
    (!candidate.text.endsWith(":") &&
      (candidate.section === "unclassified" || candidate.section === "medication"))
  );
}
function deterministic(candidate: SourceCandidate): boolean {
  return (
    candidate.fixed === true ||
    (candidate.kind === "sentence" && administrativeSentence.test(candidate.text))
  );
}
function groundCandidate(
  page: DocumentPage,
  candidate: SourceCandidate,
  type: DocumentStatement["type"],
  quote = candidate.text,
): DocumentStatement {
  const source = sourceQuote(candidate.text, quote);
  return statementSchema.parse({
    type,
    quote: source,
    page: page.page,
    bbox: locateQuote(page, source, candidate.start + candidate.text.indexOf(source)),
  });
}
function selectionType(
  candidate: SourceCandidate,
  selection: Selection,
): DocumentStatement["type"] {
  const administrative =
    candidate.kind === "task_row" ||
    candidate.kind === "vaccination_record" ||
    (candidate.kind === "field" && candidate.section === "medication");
  if (administrative) return "administrative_fact";
  return navigationRecommendation.test(candidate.text)
    ? "documented_recommendation"
    : selection.type;
}
function selectedStatement(
  selection: Selection,
  page: DocumentPage,
  candidates: readonly SourceCandidate[],
): DocumentStatement[] {
  const candidate = candidates.find((item) => item.candidateId === selection.candidateId);
  if (!candidate || !validMedicationSelection(candidate, selection)) return [];
  try {
    if (
      candidate.kind !== "field" &&
      selection.quote !== null &&
      sourceQuote(candidate.text, selection.quote) !== candidate.text
    )
      return [];
    const quote =
      candidate.kind === "field" && selection.quote !== null ? selection.quote : candidate.text;
    return [groundCandidate(page, candidate, selectionType(candidate, selection), quote)];
  } catch (error) {
    if (error instanceof DocumentError && error.code === "ungrounded_statement") return [];
    throw error;
  }
}
function validMedicationSelection(candidate: SourceCandidate, selection: Selection): boolean {
  if (candidate.section !== "medication" || candidate.kind !== "field") return true;
  // Medication fields contain clinical columns: require a name, never a group or instruction.
  return selection.quote !== null && !medicationExcludedQuote.test(selection.quote);
}
async function selectCandidates(
  page: DocumentPage,
  candidates: readonly SourceCandidate[],
  signal?: AbortSignal,
): Promise<Selection[]> {
  const result = await generateText({
    model: modelFor("extractor"),
    output: Output.object({ schema: selectionSchema }),
    instructions: DOCUMENT_EXTRACTION_INSTRUCTIONS,
    prompt: JSON.stringify({
      pages: [
        {
          page: page.page,
          candidates: candidates.map(({ start: _start, end: _end, ...candidate }) => candidate),
        },
      ],
    }),
    maxOutputTokens: DOCUMENT_MAX_OUTPUT_TOKENS,
    maxRetries: 0,
    abortSignal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(DOCUMENT_MODEL_TIMEOUT_MS)])
      : AbortSignal.timeout(DOCUMENT_MODEL_TIMEOUT_MS),
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
  });
  return selectionSchema.parse(result.output).statements;
}
async function extractPageStatements(
  sectioned: SectionedPage,
  signal?: AbortSignal,
): Promise<DocumentStatement[]> {
  signal?.throwIfAborted();
  const { page } = sectioned;
  const candidates = statementCandidates(sectioned).filter(eligible);
  const fixed = candidates
    .filter(deterministic)
    .map((candidate) => groundCandidate(page, candidate, "administrative_fact"));
  const pending = candidates.filter((candidate) => !deterministic(candidate));
  if (!pending.length) return fixed;
  try {
    const selections = await selectCandidates(page, pending, signal);
    return uniqueStatements([
      ...fixed,
      ...selections.flatMap((selection) => selectedStatement(selection, page, pending)),
    ]);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("extraction_failed");
  }
}
function uniqueStatements(statements: readonly DocumentStatement[]): DocumentStatement[] {
  return statements.filter(
    (statement, index) =>
      statements.findIndex(
        (other) =>
          other.type === statement.type &&
          other.page === statement.page &&
          other.quote === statement.quote &&
          other.bbox.x === statement.bbox.x &&
          other.bbox.y === statement.bbox.y,
      ) === index,
  );
}
function fullestVisit(
  statement: DocumentStatement,
  statements: readonly DocumentStatement[],
): boolean {
  if (!deduplicatePrefix.test(statement.quote)) return true;
  const quote = statement.quote.replace(/\s+/gu, " ").trim();
  return !statements.some(
    (other) =>
      other.type === statement.type &&
      other.quote.length > statement.quote.length &&
      other.quote.replace(/\s+/gu, " ").trim().startsWith(quote),
  );
}

/** Review navigation sections independently of clinical findings, retaining cross-page ownership. */
export async function extractDocumentStatements(
  pages: readonly DocumentPage[],
  signal?: AbortSignal,
  pageRange?: { from: number; to: number },
): Promise<DocumentStatement[]> {
  const statements: DocumentStatement[] = [];
  for (const sectioned of documentSections(pages)) {
    signal?.throwIfAborted();
    if (pageRange && (sectioned.page.page < pageRange.from || sectioned.page.page > pageRange.to))
      continue;
    if (sectioned.page.text.trim())
      statements.push(...(await extractPageStatements(sectioned, signal)));
  }
  return uniqueStatements(statements).filter((statement) => fullestVisit(statement, statements));
}
