import { expect, test } from "vitest";
import {
  explainReimbursement,
  type FeePosition,
  FeePositionSchema,
} from "../../../src/loaders/fees/index.ts";

// Administrative example copied from the real Styria schedule, PDF page 40.
const position: FeePosition = {
  code: "250",
  title: "Versorgung einer Finger- oder Zehenfraktur",
  amount: 23.01,
  unit: "EUR",
  section: "ABSCHNITT II",
  region: "Steiermark",
  asOf: "2025-01-01",
  page: 40,
  carrier: "ÖGK",
  tariffKind: "complete",
  sourceQuote: "250 Versorgung einer Finger- oder Zehenfraktur 23,01",
};

test("FR-M2 AC2 uses 80% of the tariff, labels amounts illustrative and preserves provenance", () => {
  const result = explainReimbursement({ position, paidAmount: 100 });
  expect(result).toMatchObject({
    contractTariff: 23.01,
    eightyPercentAmount: 18.41,
    region: "Steiermark",
    asOf: "2025-01-01",
    illustrative: true,
    binding: false,
    currency: "EUR",
  });
  expect(result.explanation).toContain("80 % des Vertragstarifs");
  expect(result.explanation).toContain("unverbindlich");
  expect(result.explanation).toContain("2025-01-01");
  expect(result.explanation).toContain("Steiermark");
  expect(explainReimbursement({ position, paidAmount: 10 }).eightyPercentAmount).toBe(18.41);
});

test("FR-M2 rejects invalid amounts and non-euro or partial tariffs rather than inventing reimbursement", () => {
  for (const paidAmount of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.001]) {
    expect(() => explainReimbursement({ position, paidAmount })).toThrow();
  }
  for (const override of [{ unit: "points" }, { tariffKind: "component" }] as const) {
    expect(() =>
      explainReimbursement({ position: { ...position, ...override }, paidAmount: 100 }),
    ).toThrow();
  }
  expect(FeePositionSchema.safeParse({ ...position, asOf: "2025-02-30" }).success).toBe(false);
  expect(FeePositionSchema.safeParse({ ...position, page: 0 }).success).toBe(false);
});
