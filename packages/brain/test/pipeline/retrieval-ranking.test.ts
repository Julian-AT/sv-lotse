import { expect, test } from "vitest";
import { reciprocalRankFusion } from "../../src/retrieval/index.ts";
import { expandQuery } from "../../src/retrieval/synonyms.ts";

test("weighted fusion lets semantic intent outrank a lexical-only hit", () => {
  expect(reciprocalRankFusion([[{ id: "lexical" }], [{ id: "semantic" }]], 1, [0.5, 1])).toEqual([
    { id: "semantic" },
  ]);
});

test("duplicate candidates in one rank list cannot inflate their score", () => {
  const lists = [[{ id: "lexical" }, { id: "lexical" }], [{ id: "semantic" }]];
  expect(reciprocalRankFusion(lists, 1, [0.5, 1])).toEqual([{ id: "semantic" }]);
});

test("phrase synonyms respect word boundaries and hyphenated spelling", () => {
  const groups = [
    ["e-card", "Sozialversicherungskarte"],
    ["halber Selbstbehalt", "Kostenanteil"],
  ];
  expect(expandQuery("E Card verloren", groups)).toContain("Sozialversicherungskarte");
  expect(expandQuery("unhalber Selbstbehalt", groups)).not.toContain("Kostenanteil");
});
