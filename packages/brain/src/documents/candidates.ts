import { documentExtractionPolicy } from "@lotse/knowledge/document-policy";
import { z } from "zod";
import { DOCUMENT_MAX_STATEMENTS, DOCUMENT_PARAGRAPH_LINE_HEIGHT_RATIO } from "./config.ts";
import { administrativeField, metadataSpans, rowValuePrefix } from "./metadata.ts";
import { type DocumentLine, type DocumentPage, statementTypeSchema } from "./schema.ts";
import type { DocumentSection, SectionedPage } from "./sections.ts";

export interface SourceCandidate {
  candidateId: number;
  kind: "field" | "sentence" | "task_row" | "vaccination_record";
  section: DocumentSection["kind"];
  heading: string | null;
  start: number;
  end: number;
  text: string;
  fixed?: boolean;
}
export const selectionSchema = z.object({
  statements: z
    .array(
      z.object({
        candidateId: z.int().nonnegative(),
        type: statementTypeSchema,
        quote: z.string().min(1).nullable(),
      }),
    )
    .max(DOCUMENT_MAX_STATEMENTS),
});
const metadata = new RegExp(documentExtractionPolicy.metadata_pattern, "iu");
const tableHeader = new RegExp(documentExtractionPolicy.table_header_pattern, "iu");
const vaccinationStart = new RegExp(documentExtractionPolicy.vaccination_start_pattern, "iu");
const vaccinationEnd = new RegExp(documentExtractionPolicy.vaccination_end_pattern, "iu");
const abbreviations = new Set(
  documentExtractionPolicy.sentence_abbreviations.map((text) => text.toLowerCase()),
);
interface SourceLine extends DocumentLine {
  start: number;
  end: number;
}

function sourceLines(page: DocumentPage): SourceLine[] {
  let offset = 0;
  return page.lines.map((line) => {
    const start = offset;
    offset += line.text.length + 1;
    return { ...line, start, end: offset - 1 };
  });
}
function separateLine(previous: SourceLine, line: SourceLine, table: boolean): boolean {
  return (
    /^\s*[•*-]\s/u.test(line.text) ||
    (!table && administrativeField.test(line.text.trim())) ||
    (!table && /[.!?:]\s*$/u.test(previous.text)) ||
    line.bbox.y - previous.bbox.y > previous.bbox.height * DOCUMENT_PARAGRAPH_LINE_HEIGHT_RATIO
  );
}

/** Split only at sentence punctuation; newlines and abbreviations never rewrite the source. */
function sentenceSpans(text: string, start: number, end: number): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let cursor = start;
  for (const match of text.slice(start, end).matchAll(/[.!?](?=\s+\p{Lu})/gu)) {
    const boundary = start + match.index + 1;
    const word = text.slice(cursor, boundary).match(/([\p{L}\p{N}]+)[.!?]$/u)?.[1];
    if (word && (abbreviations.has(word.toLowerCase()) || /^\d+$/u.test(word))) continue;
    spans.push({ start: cursor, end: boundary });
    cursor = boundary;
  }
  spans.push({ start: cursor, end });
  return spans;
}

function candidate(
  page: DocumentPage,
  section: DocumentSection,
  kind: SourceCandidate["kind"],
  start: number,
  end: number,
): Omit<SourceCandidate, "candidateId"> | undefined {
  const raw = page.text.slice(start, end);
  const leading =
    (raw.match(/^\s*(?:[•*-]\s+)?/u)?.[0].length ?? 0) +
    (raw.match(rowValuePrefix)?.[0].length ?? 0);
  const text = raw.slice(leading).trimEnd();
  if (!text) return undefined;
  return {
    kind,
    section: section.kind,
    heading: section.heading,
    start: start + leading,
    end: start + leading + text.length,
    text,
  };
}

type CandidateBody = Omit<SourceCandidate, "candidateId">;
interface CandidateState {
  group: SourceLine[];
  kind: SourceCandidate["kind"];
  inTable: boolean;
  output: CandidateBody[];
}
function groupCandidates(
  page: DocumentPage,
  section: DocumentSection,
  state: CandidateState,
): CandidateBody[] {
  const first = state.group[0],
    last = state.group.at(-1);
  if (!first || !last) return [];
  const spans =
    state.kind === "field"
      ? sentenceSpans(page.text, first.start, last.end)
      : [{ start: first.start, end: last.end }];
  return spans.flatMap((span) => {
    const kind =
      state.kind === "field" && /[.!?]\s*$/u.test(page.text.slice(span.start, span.end))
        ? "sentence"
        : state.kind;
    const item = candidate(page, section, kind, span.start, span.end);
    return item ? [item] : [];
  });
}
function flushGroup(page: DocumentPage, section: DocumentSection, state: CandidateState): void {
  state.output.push(...groupCandidates(page, section, state));
  state.group = [];
}
function metadataCandidates(
  page: DocumentPage,
  section: DocumentSection,
  line: SourceLine,
): CandidateBody[] {
  const allowed =
    section.kind === "unclassified" ||
    (section.kind === "clinical" && metadata.test(line.text.trim()));
  if (!allowed) return [];
  return metadataSpans(line.text, page.page === 1 && section.kind === "unclassified").flatMap(
    (span) => {
      const item = candidate(
        page,
        section,
        "field",
        line.start + span.start,
        line.start + span.end,
      );
      return item ? [{ ...item, fixed: true }] : [];
    },
  );
}
function startsNewGroup(state: CandidateState, line: SourceLine): boolean {
  const previous = state.group.at(-1);
  return (
    previous !== undefined &&
    state.kind !== "vaccination_record" &&
    separateLine(previous, line, state.inTable)
  );
}
function appendLine(
  page: DocumentPage,
  section: DocumentSection,
  state: CandidateState,
  line: SourceLine,
): void {
  if (tableHeader.test(line.text.trim()) || line.text === section.heading) {
    flushGroup(page, section, state);
    if (tableHeader.test(line.text.trim())) state.inTable = true;
    return;
  }
  if (vaccinationStart.test(line.text)) {
    flushGroup(page, section, state);
    state.kind = "vaccination_record";
    state.group.push(line);
    return;
  }
  if (startsNewGroup(state, line)) flushGroup(page, section, state);
  if (!state.group.length) state.kind = state.inTable ? "task_row" : "field";
  state.group.push(line);
  if (state.kind === "vaccination_record" && vaccinationEnd.test(line.text.trim()))
    flushGroup(page, section, state);
}
function sectionCandidates(
  page: DocumentPage,
  section: DocumentSection,
  lines: SourceLine[],
): CandidateBody[] {
  const state: CandidateState = {
    group: [],
    kind: "field",
    inTable: section.kind === "tasks",
    output: [],
  };
  for (const line of lines) {
    const facts = metadataCandidates(page, section, line);
    if (facts.length) {
      flushGroup(page, section, state);
      state.output.push(...facts);
      continue;
    }
    if (section.kind === "clinical" && !metadata.test(line.text.trim())) continue;
    appendLine(page, section, state, line);
  }
  flushGroup(page, section, state);
  return state.output;
}

/** The model selects source spans; it cannot merge list items or drop table responsibilities. */
export function statementCandidates({ page, sections }: SectionedPage): SourceCandidate[] {
  const lines = sourceLines(page);
  return sections
    .flatMap((section) =>
      sectionCandidates(
        page,
        section,
        lines.filter((line) => line.start >= section.start && line.end <= section.end),
      ),
    )
    .map((item, candidateId) => ({ ...item, candidateId }));
}
