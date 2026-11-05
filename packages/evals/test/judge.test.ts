import { expect, test } from "vitest";
import { loadRubric, RubricSchema, scoreSchema } from "../src/judge/index.ts";

const sample = new URL("../rubrics/sample.v1.yaml", import.meta.url);
test("versioned rubrics require written binary or three-point anchors", async () => {
  const rubric = await loadRubric(sample);
  expect(rubric.version).toBe("1");
  expect(
    RubricSchema.safeParse({
      ...rubric,
      criteria: [{ id: "missing", scale: "binary", anchors: { "0": "Bad" } }],
    }).success,
  ).toBe(false);
  expect(
    RubricSchema.safeParse({ ...rubric, criteria: [rubric.criteria[0], rubric.criteria[0]] })
      .success,
  ).toBe(false);
  const scenario = await loadRubric(new URL("../rubrics/scenario.v1.yaml", import.meta.url));
  expect(scenario.criteria).toHaveLength(9);
});

test("judge output requires exactly the rubric criteria, bounded scores and short rationales", async () => {
  const rubric = await loadRubric(sample);
  const schema = scoreSchema(rubric);
  const good = {
    correctness: { score: 1, rationale: "Correct answer." },
    language: { score: 2, rationale: "Clear German." },
  };
  expect(schema.parse(good)).toEqual(good);
  expect(schema.safeParse({ correctness: good.correctness }).success).toBe(false);
  expect(schema.safeParse({ ...good, extra: good.correctness }).success).toBe(false);
  expect(
    schema.safeParse({ ...good, correctness: { score: 2, rationale: "Not binary" } }).success,
  ).toBe(false);
});
