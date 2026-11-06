import { generateText, Output } from "ai";
import { z } from "zod";
import { modelFor } from "../models/index.ts";
import {
  LETTER_MAX_OUTPUT_TOKENS,
  LETTER_MAX_TEXT_CHARACTERS,
  LETTER_TIMEOUT_MS,
} from "./config.ts";
import { LETTER_INSTRUCTIONS, letterCopy } from "./copy.ts";
import {
  type LetterAnalysis,
  type LetterExplanation,
  type LetterPage,
  letterAnalysisSchema,
  letterExplanationSchema,
} from "./letter-schema.ts";
import { DeadlineError } from "./schema.ts";

export {
  type LetterAnalysis,
  type LetterExplanation,
  type LetterPage,
  letterAnalysisSchema,
  letterExplanationSchema,
} from "./letter-schema.ts";

export function readLetterPages(raw: unknown): LetterPage[] {
  const parsed = z
    .array(z.object({ page: z.int().positive().optional(), text: z.string() }))
    .safeParse(raw);
  if (!parsed.success) throw new DeadlineError("document_not_ready");
  const pages = parsed.data.map((entry, index) => ({
    page: entry.page ?? index + 1,
    text: entry.text,
  }));
  const length = pages.reduce((total, entry) => total + entry.text.length, 0);
  if (
    !length ||
    length > LETTER_MAX_TEXT_CHARACTERS ||
    new Set(pages.map((entry) => entry.page)).size !== pages.length
  )
    throw new DeadlineError("document_not_ready");
  return pages;
}

/** A relative deadline can be explained, but never silently turned into a calendar date. */
export function dateOccursInQuote(date: string, sourceQuote: string): boolean {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return false;
  const numeric = new RegExp(
    `(?<!\\d)0?${Number(day)}\\.\\s*0?${Number(month)}\\.\\s*${year}(?!\\d)`,
  );
  return new RegExp(`(?<!\\d)${date}(?!\\d)`).test(sourceQuote) || numeric.test(sourceQuote);
}

/** Reject the entire result on a fabricated quote; never persist partial ungrounded output. */
export function groundLetterAnalysis(raw: unknown, pages: readonly LetterPage[]): LetterAnalysis {
  const analysis = letterAnalysisSchema.parse(raw);
  const citations = [
    ...(analysis.summary ? [analysis.summary] : []),
    ...analysis.requiredActions,
    ...analysis.deadlines,
    ...analysis.nextSteps,
  ];
  for (const entry of citations) {
    if (!pages.find((page) => page.page === entry.page)?.text.includes(entry.quote))
      throw new DeadlineError("ungrounded_letter");
  }
  if (analysis.kind === "unsupported" && citations.length)
    throw new DeadlineError("ungrounded_letter");
  if (analysis.kind === "administrative" && !analysis.summary)
    throw new DeadlineError("ungrounded_letter");
  return {
    ...analysis,
    deadlines: analysis.deadlines.map((deadline) => ({
      ...deadline,
      dueAt:
        deadline.dueAt && dateOccursInQuote(deadline.dueAt, deadline.quote) ? deadline.dueAt : null,
    })),
  };
}

/** Only provider boundary; no product stubs, no raw provider errors or user content in logs. */
export async function analyzeLetter(
  pages: readonly LetterPage[],
  signal?: AbortSignal,
): Promise<LetterAnalysis> {
  signal?.throwIfAborted();
  try {
    const result = await generateText({
      model: modelFor("extractor"),
      output: Output.object({ schema: letterAnalysisSchema }),
      instructions: LETTER_INSTRUCTIONS,
      prompt: JSON.stringify({ pages }),
      maxOutputTokens: LETTER_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(LETTER_TIMEOUT_MS)])
        : AbortSignal.timeout(LETTER_TIMEOUT_MS),
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    });
    return groundLetterAnalysis(result.output, pages);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof DeadlineError) throw error;
    throw new DeadlineError("letter_extraction_failed");
  }
}

export function explainLetterAnalysis(
  documentId: string,
  analysis: LetterAnalysis,
): LetterExplanation {
  return letterExplanationSchema.parse({ ...analysis, documentId, notice: letterCopy.de.notice });
}
