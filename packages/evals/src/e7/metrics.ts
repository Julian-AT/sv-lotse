import type { z } from "zod";
import type { CaseResult } from "../schema/index.ts";
import type { E7ExpectedSchema } from "./data.ts";

type Values = z.infer<typeof E7ExpectedSchema>;
export function normalizePrefill(value: Values[string]): Values[string] {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/gu, " ").trim() : value;
}

/** Empty gold is a separate safety score, never padding the fill-accuracy denominator. */
export function scorePrefill(expected: Values, actual: Values): Record<string, number> {
  let positiveFields = 0,
    exactCorrect = 0,
    normalizedCorrect = 0,
    blankFields = 0,
    blankCorrect = 0;
  for (const [id, gold] of Object.entries(expected)) {
    const value = actual[id] ?? null;
    if (gold === null) {
      blankFields++;
      if (value === null) blankCorrect++;
    } else {
      positiveFields++;
      if (value === gold) exactCorrect++;
      if (normalizePrefill(value) === normalizePrefill(gold)) normalizedCorrect++;
    }
  }
  const unexpectedProposals = Object.keys(actual).filter(
    (id) => !Object.hasOwn(expected, id),
  ).length;
  return {
    positiveFields,
    exactCorrect,
    normalizedCorrect,
    blankFields,
    blankCorrect,
    unexpectedProposals,
    exactMatch: positiveFields ? exactCorrect / positiveFields : 1,
    normalizedMatch: positiveFields ? normalizedCorrect / positiveFields : 1,
    blankAccuracy: blankFields ? blankCorrect / blankFields : 1,
  };
}

export function reducePrefill(results: readonly CaseResult[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const result of results)
    for (const [key, value] of Object.entries(result.metrics))
      if (!["exactMatch", "normalizedMatch", "blankAccuracy"].includes(key))
        totals[key] = (totals[key] ?? 0) + value;
  return {
    ...totals,
    exactMatch: (totals.exactCorrect ?? 0) / (totals.positiveFields || 1),
    normalizedMatch: (totals.normalizedCorrect ?? 0) / (totals.positiveFields || 1),
    blankAccuracy: (totals.blankCorrect ?? 0) / (totals.blankFields || 1),
  };
}
