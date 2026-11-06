import { describe, expect, it } from "vitest";
import { containedPath } from "../src/baseline/data.ts";
import { passageRanking } from "../src/baseline/e3.ts";
import { exactSlotMap } from "../src/baseline/e11.ts";
import { matchStatements } from "../src/baseline/e12.ts";

it("keeps gold PDF paths inside the fixture directory", () => {
  expect(containedPath("/tmp/eval", "pdfs/form.pdf")).toBe("/tmp/eval/pdfs/form.pdf");
  expect(() => containedPath("/tmp/eval", "../secrets")).toThrow();
});
it("requires full source passage coverage and matching URL for retrieval credit", () => {
  const hits = [
    { id: "one", url: "https://example.org", text: "answer fragment" },
    { id: "two", url: "https://example.org", text: "prefix full\n answer suffix" },
    { id: "three", url: "https://other.org", text: "full answer" },
  ];
  expect(passageRanking(hits, "https://example.org", "full answer")).toEqual([
    "one",
    "gold-passage",
    "three",
  ]);
});
it("counts missing and extra extracted slots as errors", () => {
  expect(exactSlotMap({ carrier: "OEGK" }, { carrier: "OEGK" })).toBe(true);
  expect(exactSlotMap({}, { carrier: "OEGK" })).toBe(false);
  expect(exactSlotMap({ carrier: "OEGK", extra: "value" }, { carrier: "OEGK" })).toBe(false);
});
describe("E12 strict quotation scoring", () => {
  const bbox = { x: 0, y: 0, width: 1, height: 1 };
  const statement = {
    type: "administrative_fact" as const,
    quote: "Aktenzahl: 123",
    page: 1,
    bbox,
  };
  const gold = [{ quote: statement.quote, page: 1, factType: "case_number" }];
  it("does not award duplicate, substring, wrong-page or wrong-type credit", () => {
    expect(matchStatements([statement, statement], gold)).toBe(1);
    expect(matchStatements([{ ...statement, quote: "123" }], gold)).toBe(0);
    expect(matchStatements([{ ...statement, page: 2 }], gold)).toBe(0);
    expect(matchStatements([{ ...statement, type: "documented_recommendation" }], gold)).toBe(0);
  });
});
