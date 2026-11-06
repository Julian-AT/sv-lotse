import { z } from "zod";
import { LETTER_MAX_ITEMS } from "./config.ts";

const text = z.string().trim().min(1);
const quote = z.string().refine((value) => value.trim().length > 0);
const citation = z.object({ text, quote, page: z.int().positive() });

export const letterAnalysisSchema = z.object({
  kind: z.enum(["administrative", "unsupported"]),
  summary: citation.nullable(),
  requiredActions: z.array(citation).max(LETTER_MAX_ITEMS),
  deadlines: z
    .array(
      z.object({
        title: text,
        dueAt: z.iso.date().nullable(),
        quote,
        page: z.int().positive(),
      }),
    )
    .max(LETTER_MAX_ITEMS),
  nextSteps: z.array(citation).max(LETTER_MAX_ITEMS),
});

export const letterExplanationSchema = letterAnalysisSchema.extend({
  documentId: z.uuid(),
  notice: text,
});

export type LetterAnalysis = z.infer<typeof letterAnalysisSchema>;
export type LetterPage = { page: number; text: string };
export type LetterExplanation = z.infer<typeof letterExplanationSchema>;
