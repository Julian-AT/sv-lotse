import { expect, test } from "vitest";
import { parseFeePages } from "../../../src/loaders/fees/parser.ts";
import type { TextLine } from "../../../src/loaders/fees/pdf.ts";

// Small text-layer fragments transcribed from the real PDFs, for isolated layout regressions.
const line = (y: number, cells: [number, string][]): TextLine => ({
  y,
  cells: cells.map(([x, text]) => ({ x, text, y, height: 10 })),
});

test("FR-M2 refuses unsupported snapshots and empty tariff tables", () => {
  expect(() => parseFeePages([], "styria", "source.pdf")).toThrow(/147 pages/);
  const pages: TextLine[][] = Array.from({ length: 48 }, () => []);
  expect(() => parseFeePages(pages, "dental", "source.pdf")).toThrow(/schedule date/);
  pages[0] = [line(700, [[100, "2026"]])];
  expect(() => parseFeePages(pages, "dental", "source.pdf")).toThrow(/tariff header/);
});

test("FR-M2 reports unpriced candidates explicitly", () => {
  const pages: TextLine[][] = Array.from({ length: 147 }, () => []);
  pages[0] = [line(700, [[100, "Stand: 01.01.2025"]])];
  pages[24] = [
    line(780, [[470, "ABSCHNITT I"]]),
    line(700, [
      [70, "Pos.Nr.:"],
      [113, "Art der Leistung:"],
      [460, "€"],
    ]),
    line(600, [
      [70, "003"],
      [113, "Tagbesuch an Werktagen"],
      [456, "41,13"],
    ]),
    line(500, [
      [70, "004"],
      [113, "Tagbesuch an Sonn- oder Feiertagen"],
    ]),
  ];
  expect(parseFeePages(pages, "styria", "source.pdf")).toMatchObject({
    candidateCount: 2,
    parsedCount: 1,
    coverage: 0.5,
    unparsed: [{ code: "004", page: 25 }],
  });
});
