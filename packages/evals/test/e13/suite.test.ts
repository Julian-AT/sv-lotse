import { expect, test } from "vitest";
import { createE13Suite, type E13Fixture } from "../../src/e13/index.ts";
import { type EvaluationField, measureFields } from "../../src/e13/metrics.ts";
import { Registry, runSuite } from "../../src/runner/index.ts";

const options = { modelVersion: "fixture-v1", gitSha: "a".repeat(40) };
const field = (index: number): EvaluationField => ({
  box: { page: 1, x: 0, y: index * 20, width: 100, height: 10 },
  label_de: `Feld ${index + 1}`,
  owner: "applicant",
});

// Synthetic geometry isolates denominator and threshold cases without a provider dependency.
function fixture(index: number, fields: number): E13Fixture {
  return {
    id: `form-${index.toString().padStart(2, "0")}`,
    tags: ["pr"],
    input: index,
    gold: Array.from({ length: fields }, (_, i) => field(i)),
    source: { uri: "urn:synthetic:e13:aggregation", passage: "Synthetic field geometry." },
  };
}

test("E13 reports raw one-to-one field counts with box, label and owner diagnostics", () => {
  const metrics = measureFields(
    [field(0), { ...field(1), label_de: "Andere Angabe" }, { ...field(2), owner: "office" }],
    [field(0), field(1), field(2), field(3)],
  );
  expect(metrics).toMatchObject({
    goldCount: 4,
    detectedCount: 3,
    matchedCount: 1,
    boxMatchedCount: 3,
    labelMatchedCount: 2,
    ownerMatchedCount: 2,
    recall: 1 / 4,
    precision: 1 / 3,
  });
});

test("AC2 E13 weights fields rather than forms when a large form is missed", async () => {
  const fixtures = Array.from({ length: 20 }, (_, i) => fixture(i, i === 19 ? 100 : 1));
  const registry = new Registry();
  registry.register(createE13Suite(fixtures, async (input) => (input === 19 ? [] : [field(0)])));
  const result = await runSuite(registry.get("E13"), options);
  expect(result.metrics).toMatchObject({
    goldCount: 119,
    detectedCount: 19,
    matchedCount: 19,
    precision: 1,
    boxPrecision: 1,
    labelMatch: 1,
    ownerMatch: 1,
    passRate: 19 / 20,
  });
  expect(result.metrics.recall).toBeCloseTo(19 / 119);
  expect(result.metrics.boxRecall).toBeCloseTo(19 / 119);
  expect(result.metrics.targetAttainment).toBeCloseTo(19 / 119 / 0.9);
  expect(result.suite.gate.kind).toBe("informational");
  expect(result.gateVerdict).toBe("failed");
});

test("AC2 E13 passes 99% suite recall and 100% precision despite a missed form", async () => {
  const fixtures = Array.from({ length: 20 }, (_, i) => fixture(i, i === 0 ? 81 : 1));
  const suite = createE13Suite(fixtures, async (input) => {
    if (input === 19) return [];
    return input === 0 ? (fixtures[0]?.gold ?? []) : [field(0)];
  });
  const result = await runSuite(suite, options);
  expect(result.metrics).toMatchObject({ goldCount: 100, matchedCount: 99, detectedCount: 99 });
  expect(result.metrics.recall).toBe(0.99);
  expect(result.metrics.precision).toBe(1);
  expect(result.metrics.targetAttainment).toBe(1);
  expect(result.counts).toEqual({ total: 20, passed: 19, failed: 1, errors: 0 });
  expect(result.gateVerdict).toBe("passed");
});

test.each([
  { matched: 90, detected: 94, passed: true },
  { matched: 89, detected: 89, passed: false },
  { matched: 95, detected: 100, passed: true },
  { matched: 94, detected: 100, passed: false },
  { matched: 0, detected: 0, passed: false },
])(
  "E13 applies suite targets at 90% recall and 95% precision: %j",
  async ({ matched, detected, passed }) => {
    const fixtures = Array.from({ length: 20 }, (_, i) => fixture(i, 5));
    const suite = createE13Suite(fixtures, async (input) => {
      const index = Number(input);
      const correct = fixtures[index]?.gold.filter((_, i) => index * 5 + i < matched) ?? [];
      return index === 0
        ? [...correct, ...Array.from({ length: detected - matched }, (_, i) => field(10 + i))]
        : correct;
    });
    const result = await runSuite(suite, options);
    expect(result.metrics.recall).toBe(matched / 100);
    expect(result.metrics.precision).toBe(detected ? matched / detected : 0);
    expect(result.gateVerdict).toBe(passed ? "passed" : "failed");
  },
);

test("E13 reduces only selected forms and preserves insufficient-data and error verdicts", async () => {
  const fixtures = Array.from({ length: 20 }, (_, i) => fixture(i, 1));
  const suite = createE13Suite(fixtures, async () => [field(0)]);
  const sample = await runSuite(suite, { ...options, sample: 3 });
  expect(sample.metrics).toMatchObject({ goldCount: 3, matchedCount: 3, recall: 1, precision: 1 });
  expect(sample.gateVerdict).toBe("insufficient_data");
  const empty = await runSuite(suite, { ...options, sample: 0 });
  expect(empty.metrics.recall).toBeNull();
  expect(empty.metrics.targetAttainment).toBeNull();
  expect(empty.gateVerdict).toBe("insufficient_data");
  suite.execute = async () => {
    throw new Error("detection failed");
  };
  const failed = await runSuite(suite, options);
  expect(failed.counts.errors).toBe(20);
  expect(failed.metrics.targetAttainment).toBeNull();
  expect(failed.gateVerdict).toBe("failed");
});
