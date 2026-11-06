import type { ToolName } from "../tools/contracts/index.ts";

/**
 * Short, claim-free status lines for tool steps that take time. They name only what Lotse is
 * doing, never a fact, so they may be streamed before the answer guards run.
 */
export type StatusFamily = "lookup" | "office" | "documents";

export const statusCopy: Record<"de" | "en", Record<StatusFamily, string>> = {
  de: {
    lookup: "Einen Moment, ich schaue das kurz nach …",
    office: "Ich suche die zuständige Stelle …",
    documents: "Ich prüfe die Unterlagen …",
  },
  en: {
    lookup: "One moment, I'm looking that up …",
    office: "I'm finding the responsible office …",
    documents: "I'm checking the documents …",
  },
};

const families: Partial<Record<ToolName, StatusFamily>> = {
  "kb.search": "lookup",
  "catalog.findBenefits": "lookup",
  "catalog.getBenefit": "lookup",
  "eko.lookupCoverage": "lookup",
  "fees.explainReimbursement": "lookup",
  "web.findOfficialPage": "lookup",
  "web.readPage": "lookup",
  "office.resolve": "office",
  "facility.search": "office",
  "appointment.search": "office",
  "form.find": "documents",
  "form.acquire": "documents",
  "form.analyze": "documents",
  "form.getSchema": "documents",
  "form.prefill": "documents",
  "documents.checklist": "documents",
  "docs.extractStatements": "documents",
  "docs.explainLetter": "documents",
};

export function statusFor(toolName: string, language: string): string | undefined {
  const family = families[toolName as ToolName];
  if (!family) return undefined;
  return statusCopy[language.toLowerCase().startsWith("de") ? "de" : "en"][family];
}

/** Returns the status line for the first slow tool of a turn, and nothing afterwards. */
export function createStatusAnnouncer(language: string): (toolName: string) => string | undefined {
  let announced = false;
  return (toolName) => {
    if (announced) return undefined;
    const text = statusFor(toolName, language);
    if (text) announced = true;
    return text;
  };
}

/** The transient status part for a stream chunk, emitted when a slow tool step starts. */
export function statusPart(
  part: { type: string; toolName?: string },
  announce: (toolName: string) => string | undefined,
  turnId: string,
): { type: "data-status"; data: { turnId: string; text: string }; transient: true } | undefined {
  if (part.type !== "tool-input-start" || !part.toolName) return undefined;
  const text = announce(part.toolName);
  return text ? { type: "data-status", data: { turnId, text }, transient: true } : undefined;
}
