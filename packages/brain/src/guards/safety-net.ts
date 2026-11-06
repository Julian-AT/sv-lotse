import type { SafetyNotice } from "@lotse/protocol";
import { z } from "zod";
import { guardLocale } from "./copy.ts";
import { safetyData } from "./data.ts";

const inputSchema = z.strictObject({
  text: z.string(),
  source: z.enum(["user", "document", "page", "screen"]),
  language: z.string().optional(),
});
export interface SafetyDetection {
  patternId: string;
  category: "emergency" | "crisis";
  notice: SafetyNotice;
}
/** SR-1 only inspects explicit user statements. No severity score or follow-up inference. */
export function detectSafetyNet(input: z.input<typeof inputSchema>): SafetyDetection | null {
  const parsed = inputSchema.parse(input);
  if (parsed.source !== "user") return null;
  const clauses = parsed.text
    .normalize("NFKC")
    .split(/[.!?\n]+|\b(?:aber|but)\b/iu)
    .flatMap((clause) => [clause, ...clause.split(/[,;]/u)]);
  for (const clause of clauses) {
    if (safetyData.nonCurrent.some((pattern) => pattern.test(clause))) continue;
    for (const pattern of safetyData.patterns) {
      if (pattern.expression.test(clause)) {
        return {
          patternId: pattern.id,
          category: pattern.category === "crisis" ? "crisis" : "emergency",
          notice: safetyNotice(parsed.language),
        };
      }
    }
  }
  return null;
}
export function safetyNotice(language?: string): SafetyNotice {
  return structuredClone(safetyData.notices[guardLocale(language)]);
}

/**
 * Remove only non-current crisis terminology from model context after the original SR-1 check.
 * Keep the administrative task, subject and history; this never changes the persisted user text.
 */
export function boundaryTaskText(text: string): string {
  if (detectSafetyNet({ text, source: "user" })) return text;
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((clause) => {
      if (clause.includes("?") || !safetyData.nonCurrent.some((pattern) => pattern.test(clause)))
        return clause;
      return safetyData.contextTerms.reduce(
        (value, pattern) => value.replace(pattern, "[non-current context]"),
        clause,
      );
    })
    .join(" ");
}
