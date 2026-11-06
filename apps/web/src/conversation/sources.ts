import type { LotseMessage } from "@lotse/brain";
import type { FactSource, Provenance, SpeechSegment } from "@lotse/protocol";
import type { Citation } from "@lotse/ui";
import { getToolName, isToolUIPart } from "ai";
import { z } from "zod";
import { WORKSPACE_CONFIG } from "./config.ts";

/** Validity start date of a retrieved passage, keyed by passage id. */
export type PassageDates = ReadonlyMap<string, string>;
/** A sourced quote as returned by brain tools: `{ url, quote, asOf }`. */
export interface ToolSource {
  url: string;
  quote: string;
  asOf: string;
}

const passagesSchema = z.array(z.object({ id: z.string().min(1), validFrom: z.iso.date() }));
const documentSourceSchema = z.object({
  id: z.string().min(1),
  page: z.coerce.number().int().positive().optional(),
});

/** Collect validFrom dates of every passage the brain returned through its retrieval tool. */
export function passageDates(messages: readonly LotseMessage[]): Map<string, string> {
  const dates = new Map<string, string>();
  for (const message of messages)
    for (const part of message.parts) {
      if (
        !isToolUIPart(part) ||
        part.state !== "output-available" ||
        getToolName(part) !== WORKSPACE_CONFIG.passageTool
      )
        continue;
      const passages = passagesSchema.safeParse(part.output);
      if (passages.success)
        for (const passage of passages.data) dates.set(passage.id, passage.validFrom);
    }
  return dates;
}

export function speechCitations(
  segment: SpeechSegment,
  dates: PassageDates = new Map(),
): Citation[] {
  return segment.citations.map((citation) => ({
    id: citation.passageId,
    title: new URL(citation.url).hostname || citation.passageId,
    quote: citation.quote,
    url: citation.url,
    asOf: dates.get(citation.passageId) ?? "",
  }));
}

function documentUrl(documentId: string, page?: number, scope?: { subjectId: string }): string {
  return `${WORKSPACE_CONFIG.documentsApi}/${encodeURIComponent(documentId)}${scope ? `?${new URLSearchParams(scope)}` : ""}${page ? `#page=${page}` : ""}`;
}

export function factCitation(
  id: string,
  source: FactSource,
  title: string,
  scope?: { subjectId: string },
): Citation {
  return {
    id,
    title,
    quote: source.quote ?? "",
    asOf: "",
    url: source.documentId
      ? documentUrl(source.documentId, source.page, scope)
      : source.turnId
        ? `#turn-${encodeURIComponent(source.turnId)}`
        : `#fact-${encodeURIComponent(id)}`,
  };
}

export function provenanceCitations(
  provenance: Provenance[],
  title: string,
  scope?: { subjectId: string },
): Citation[] {
  return provenance.map((entry, index) =>
    factCitation(entry.factId ?? String(index), entry.source, title, scope),
  );
}

/** Imported-document sources use `document:<id>#page=<n>`; link them to the authenticated route. */
function toolSourceLink(
  raw: string,
  documentTitle: string,
  scope?: { subjectId: string },
): { url: string; title: string } {
  if (!URL.canParse(raw)) return { url: "#", title: documentTitle };
  const url = new URL(raw);
  if (url.protocol !== WORKSPACE_CONFIG.documentSourceProtocol)
    return { url: raw, title: url.hostname || raw };
  const document = documentSourceSchema.safeParse({
    id: url.pathname,
    page: new URLSearchParams(url.hash.slice(1)).get("page") ?? undefined,
  });
  return document.success
    ? { url: documentUrl(document.data.id, document.data.page, scope), title: documentTitle }
    : { url: "#", title: documentTitle };
}

/** Turn sourced tool quotes into citations, carrying the legal basis and as-of date through. */
export function toolCitations(
  sources: readonly ToolSource[],
  options: {
    key: string;
    documentTitle: string;
    legalBasis?: string;
    scope?: { subjectId: string };
  },
): Citation[] {
  return sources.map((source, index) => ({
    id: `${options.key}:${index}`,
    ...toolSourceLink(source.url, options.documentTitle, options.scope),
    quote: source.quote,
    asOf: source.asOf,
    ...(options.legalBasis ? { legalBasis: options.legalBasis } : {}),
  }));
}

/** One card per source; repeated quotes keep their first citation and gather every legal basis. */
export function uniqueCitations(citations: readonly Citation[]): Citation[] {
  const unique = new Map<string, Citation>();
  for (const citation of citations) {
    const key = `${citation.url}\n${citation.quote}`;
    const previous = unique.get(key);
    if (!previous) unique.set(key, { ...citation });
    else if (citation.legalBasis && !previous.legalBasis?.includes(citation.legalBasis))
      previous.legalBasis = previous.legalBasis
        ? `${previous.legalBasis}; ${citation.legalBasis}`
        : citation.legalBasis;
  }
  return [...unique.values()];
}

export function messageCitations(
  message: LotseMessage,
  dates: PassageDates = passageDates([message]),
): Citation[] {
  const sources = message.parts.flatMap((part): Citation[] => {
    if (part.type === "data-speech-segment") return speechCitations(part.data, dates);
    if (part.type === "source-url")
      return [
        {
          id: part.sourceId,
          title: part.title ?? new URL(part.url).hostname,
          url: part.url,
          quote: "",
          asOf: dates.get(part.sourceId) ?? "",
        },
      ];
    return [];
  });
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}
