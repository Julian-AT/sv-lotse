import { expect, test } from "vitest";
import { assertNoLeakage, checkLeakage } from "../src/checks/leakage.ts";
import type { EvalCase } from "../src/schema/index.ts";

const passage =
  "The application needs a signed form together with copies of all relevant supporting documents sent to the responsible administrative office";
const gold: EvalCase = {
  id: "question",
  kind: "gold",
  tags: ["pr"],
  input: passage,
  expected: "administrative answer",
  source: { uri: "https://example.org/source", passage },
};

test("AC6 flags a copied 20-word catalog passage and passes a sourced paraphrase", () => {
  expect(checkLeakage([gold], [{ id: "record", text: passage }], 20)).toEqual([
    { caseId: "question", corpusId: "record" },
  ]);
  expect(() => assertNoLeakage([gold], [{ id: "record", text: passage }], 20)).toThrow("leakage");
  expect(
    checkLeakage(
      [{ ...gold, input: "Which papers should accompany my request, and where do I send them?" }],
      [{ id: "record", text: passage }],
      20,
    ),
  ).toEqual([]);
});

test("leakage normalizes case and punctuation, checks expected slots and excludes provenance", () => {
  expect(
    checkLeakage(
      [{ ...gold, input: passage.toUpperCase().replaceAll(" ", ", ") }],
      [{ id: "record", text: passage }],
      20,
    ),
  ).toHaveLength(1);
  expect(
    checkLeakage(
      [{ ...gold, input: "A question", expected: { slot: passage } }],
      [{ id: "record", text: passage }],
      20,
    ),
  ).toHaveLength(1);
  expect(
    checkLeakage(
      [{ ...gold, input: "A question", expected: "An answer" }],
      [{ id: "record", text: passage }],
      20,
    ),
  ).toEqual([]);
  expect(() => checkLeakage([gold], [], 0)).toThrow();
});
