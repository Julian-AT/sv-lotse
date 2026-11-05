import { beforeAll, expect, test } from "vitest";
import {
  explainReimbursement,
  FeePositionSchema,
  type FeeSchedule,
  loadFeeSchedules,
} from "../../../src/loaders/fees/index.ts";

let schedules: FeeSchedule[];
beforeAll(async () => {
  schedules = await loadFeeSchedules();
}, 30000);

// Published totals transcribed from the separate column headers on PDF page 58.
test.each([
  ["590", 36.95],
  ["591", 51.12],
  ["592", 62.69],
  ["595", 36.95],
])("FR-M2 AC1 uses the published sonography total for position %s", (code, amount) => {
  const position = schedules
    .find((s) => s.kind === "styria")
    ?.positions.find((p) => p.code === code && p.page === 58);
  expect(position).toMatchObject({ code, amount, unit: "EUR", tariffKind: "complete" });
});

test("FR-M2 AC2 illustrates reimbursement from the real sonography total", () => {
  const position = schedules
    .find((s) => s.kind === "styria")
    ?.positions.find((p) => p.code === "590" && p.page === 58);
  if (!position) throw new Error("Missing sonography tariff on PDF page 58");
  expect(explainReimbursement({ position, paidAmount: 100 })).toMatchObject({
    contractTariff: 36.95,
    eightyPercentAmount: 29.56,
    region: "Steiermark",
    asOf: "2025-01-01",
    illustrative: true,
    binding: false,
  });
});

test("FR-M2 AC1 parses at least 95% of the Styria fee positions", () => {
  const schedule = schedules.find((entry) => entry.kind === "styria");
  expect(schedule?.pageCount).toBe(147);
  expect(schedule?.positions.length).toBeGreaterThan(600);
  expect(schedule?.coverage).toBeGreaterThanOrEqual(0.95);
  for (const position of schedule?.positions ?? [])
    expect(FeePositionSchema.safeParse(position).success).toBe(true);
});

// Independently transcribed from the PDF text layer (physical, one-based PDF pages).
test.each([
  [
    "001",
    "Nachtordination außerhalb der Ordinationszeit (Uhrzeit der Inanspruchnahme ist anzugeben; siehe Erläuterungen Pkt. 1.3.6.)",
    31.4,
    25,
  ],
  ["003", "Tagbesuch an Werktagen", 41.13, 25],
  ["004", "Tagbesuch an Sonn- oder Feiertagen", 50.34, 25],
  ["194", "Einzelkilometer bei Tag", 1, 26],
  ["195", "Einzelkilometer bei Nacht", 1.47, 26],
  ["104", "Aderlass mit Skalpell oder Nadel", 5.7, 31],
  ["105", "Aderlass mit Freilegung der Vene", 12.06, 31],
  ["106", "i.v.-Injektion", 2.64, 31],
  ["108", "i.m.-Injektion", 2.32, 31],
  ["170", "Entfernung einfacher Hornhautfremdkörper", 11.01, 36],
  ["171", "Entfernung tiefer gelegener Hornhautfremdkörper", 29.06, 36],
  ["172", "Entfernung eines Tränensackabszesses", 5.48, 36],
  ["250", "Versorgung einer Finger- oder Zehenfraktur", 23.01, 40],
  ["530", "Dezimeter-Mikrowelle", 3.71, 78],
  ["539", "Manuelle Massage", 5.79, 78],
])(
  "FR-M2 AC1 matches PDF position %s, title, euro amount and page",
  (code, title, amount, page) => {
    const position = schedules
      .find((s) => s.kind === "styria")
      ?.positions.find((p) => p.code === code && p.page === page);
    expect(position).toMatchObject({ code, title, amount, page });
  },
);

test("FR-M2 AC3 parses dental tariffs with carrier distinctions and the common shape", () => {
  const schedule = schedules.find((s) => s.kind === "dental");
  expect(schedule?.pageCount).toBe(48);
  expect(schedule?.coverage).toBeGreaterThanOrEqual(0.95);
  expect(schedule?.positions.length).toBeGreaterThan(200);
  for (const p of schedule?.positions ?? [])
    expect(FeePositionSchema.safeParse(p).success).toBe(true);
  expect(schedule?.positions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "1",
        title: "Beratung (s. Z. 1 der Erl.)",
        amount: 17,
        page: 5,
        carrier: "ÖGK / SVS-LW / Bundesheer",
        asOf: "2026-01-01",
        region: "Österreich",
      }),
      expect.objectContaining({
        code: "25",
        amount: 39.2,
        carrier: "ÖGK / SVS-LW / Bundesheer",
        page: 7,
      }),
      expect.objectContaining({ code: "25", amount: 40.4, carrier: "SVS-GW", page: 7 }),
      expect.objectContaining({ code: "25", amount: 41.7, carrier: "KFA Wien", page: 7 }),
      expect.objectContaining({ code: "2", amount: 49.4, carrier: "BVAEB", page: 14 }),
      expect.objectContaining({ code: "61", amount: 48.8, page: 6 }),
      expect.objectContaining({ code: "IF", amount: 67.4, page: 30 }),
      expect.objectContaining({ code: "K1", amount: 2125, page: 33 }),
    ]),
  );
  expect(schedule?.positions.some((p) => p.amount === 0)).toBe(false);
});

// Independent census using Poppler's pdftotext -layout, then checking tariff tables.
// Denominators count published codes, not generated carrier/variant rows. Tables
// without a numeric tariff, explanatory references and unnumbered allowances are excluded.
const styriaCensus: Record<number, number> = {
  25: 8,
  26: 6,
  31: 13,
  32: 11,
  33: 9,
  34: 5,
  35: 11,
  36: 14,
  37: 10,
  38: 16,
  39: 13,
  40: 16,
  41: 14,
  42: 8,
  43: 7,
  44: 9,
  45: 5,
  46: 5,
  47: 5,
  48: 3,
  49: 14,
  50: 14,
  51: 11,
  52: 14,
  53: 14,
  54: 9,
  55: 14,
  56: 7,
  57: 6,
  58: 5,
  76: 3,
  78: 16,
  80: 12,
  81: 9,
  83: 10,
  84: 14,
  85: 11,
  86: 7,
  87: 9,
  88: 14,
  89: 14,
  90: 9,
  91: 8,
  92: 11,
  93: 16,
  94: 16,
  95: 17,
  96: 12,
  97: 13,
  98: 11,
  99: 13,
  100: 13,
  101: 9,
  102: 4,
  113: 16,
  114: 14,
  115: 15,
  116: 12,
  117: 17,
  118: 17,
  119: 19,
  120: 18,
  121: 11,
  126: 10,
  127: 5,
  134: 12,
  135: 12,
  139: 5,
  142: 11,
};
const dentalCensus: Record<number, number> = {
  5: 11,
  6: 17,
  7: 14,
  8: 9,
  14: 14,
  15: 17,
  19: 10,
  20: 6,
  22: 6,
  30: 1,
  31: 2,
  33: 7,
};

test.each([
  ["styria", styriaCensus],
  ["dental", dentalCensus],
] as const)("FR-M2 measures %s coverage against an independent per-page census", (kind, census) => {
  const schedule = schedules.find((s) => s.kind === kind);
  expect(schedule).toBeDefined();
  let parsed = 0;
  for (const [page, expectedCount] of Object.entries(census)) {
    const codes = new Set(
      schedule?.positions.filter((p) => p.page === Number(page)).map((p) => p.code),
    );
    expect(codes.size, `PDF page ${page}`).toBe(expectedCount);
    parsed += codes.size;
  }
  const total = Object.values(census).reduce((sum, n) => sum + n, 0);
  expect(parsed / total).toBeGreaterThanOrEqual(0.95);
  expect(schedule?.candidateCount).toBe(total);
  expect(schedule?.unparsed).toEqual([]);
});

test("FR-M2 retains point units, totals radiology correctly and separates rate tiers", () => {
  const positions = schedules.find((s) => s.kind === "styria")?.positions ?? [];
  expect(positions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "020", page: 83, amount: 27, unit: "points" }),
      expect.objectContaining({ code: "644", page: 89, amount: 27, unit: "points" }),
      expect.objectContaining({
        code: "792",
        page: 120,
        amount: 27.79,
        unit: "EUR",
        tariffKind: "complete",
      }),
      expect.objectContaining({ code: "900", page: 113, amount: 6.68, tariffKind: "component" }),
      expect.objectContaining({ code: "940", page: 126, amount: 30.89, tariffKind: "complete" }),
      expect.objectContaining({ code: "840", page: 126, amount: 32.51, tariffKind: "complete" }),
      expect.objectContaining({ code: "015", amount: 10.72, tariffKind: "component" }),
    ]),
  );
  expect(positions.filter((p) => p.code === "196")).toHaveLength(1);
  expect(positions.filter((p) => p.code === "181").map((p) => p.amount)).toEqual([
    283.11, 248.89, 216.27, 182,
  ]);
  const tiers = positions.filter((p) => p.code === "541");
  expect(tiers).toHaveLength(2);
  expect(tiers[1]?.title).toContain("b) Glissonschwebe");
  expect(tiers[1]?.title).not.toContain("a) Quengeln");
});
