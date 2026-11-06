import { expect, it } from "vitest";
import { normalizePrefill, reducePrefill, scorePrefill } from "../../src/e7/metrics.ts";
import type { CaseResult } from "../../src/schema/index.ts";

it("scores missing values as wrong without padding fill accuracy with empty fields", () => {
  const scores = scorePrefill({ name: "Ada", phone: "123", doctor: null }, { name: "Ada" });
  expect(scores.exactMatch).toBe(0.5);
  expect(scores.blankAccuracy).toBe(1);
  expect(scores.positiveFields).toBe(2);
});

it("normalizes Unicode and whitespace but keeps booleans, numbers and leading zeros distinct", () => {
  expect(normalizePrefill("  Mu\u0308ller\n Anna ")).toBe("Müller Anna");
  expect(
    scorePrefill(
      { a: "Müller Anna", b: "0012", c: false },
      { a: "Mu\u0308ller\nAnna", b: 12, c: "false" },
    ),
  ).toMatchObject({
    exactCorrect: 0,
    normalizedCorrect: 1,
    positiveFields: 3,
  });
});

it("penalizes filling protected or absent fields and reports unexpected proposals", () => {
  expect(
    scorePrefill(
      { provider: null, iban: null },
      { provider: "wrong", iban: "wrong", unknown: "wrong" },
    ),
  ).toMatchObject({
    blankCorrect: 0,
    blankFields: 2,
    blankAccuracy: 0,
    unexpectedProposals: 1,
  });
});

it("pools field counts across forms instead of averaging per-form percentages", () => {
  const result = (metrics: Record<string, number>): CaseResult => ({
    caseId: "test",
    status: "passed",
    attempts: 1,
    durationMs: 0,
    metrics,
  });
  const metrics = reducePrefill([
    result(scorePrefill({ a: "x" }, { a: "x" })),
    result(scorePrefill({ a: "x", b: "y", c: "z" }, {})),
    result(scorePrefill({ hospital: null }, {})),
  ]);
  expect(metrics.positiveFields).toBe(4);
  expect(metrics.normalizedMatch).toBe(0.25);
  expect(metrics.blankAccuracy).toBe(1);
});
