import { expect, test } from "vitest";
import { z } from "zod";
import { registerE13 } from "../../../../evals/src/e13/index.ts";
import {
  type EvaluationField,
  intersectionOverUnion,
  measureFields,
} from "../../../../evals/src/e13/metrics.ts";
import { Registry, runSuite } from "../../../../evals/src/runner/index.ts";
import { detectFields } from "../../../src/forms/detect/index.ts";
import fixtures from "./fixtures.json";
import { flatten, readForm, widgetGold } from "./fixtures.ts";

const field = (
  x: number,
  label_de = "Name",
  owner: EvaluationField["owner"] = "applicant",
): EvaluationField => ({ box: { page: 1, x, y: 10, width: 30, height: 10 }, label_de, owner });

test("E13 matches one-to-one at IoU >= 0.5 with label and owner agreement", () => {
  expect(intersectionOverUnion(field(0).box, field(10).box)).toBe(0.5);
  expect(intersectionOverUnion(field(0).box, { ...field(0).box, page: 2 })).toBe(0);
  const metrics = measureFields([field(0, " NAME: "), field(0), field(90)], [field(0), field(50)]);
  expect(metrics).toMatchObject({
    boxRecall: 0.5,
    boxPrecision: 1 / 3,
    recall: 0.5,
    precision: 1 / 3,
  });
  expect(measureFields([field(0, "Name", "doctor")], [field(0)])).toMatchObject({
    boxRecall: 1,
    recall: 0,
    ownerMatch: 0,
  });
  expect(measureFields([], [])).toMatchObject({ recall: 0, precision: 0 });
  expect(() =>
    measureFields([field(0)], [{ ...field(0), box: { ...field(0).box, width: -1 } }]),
  ).toThrow();
});

test("E13 maximum matching does not lose a match to an overlapping candidate", () => {
  const gold = [field(0), field(15)];
  const detected = [field(7), field(0)];
  expect(measureFields(detected, gold)).toMatchObject({ boxRecall: 1, recall: 1 });
});

test("E13 registers and runs three real flattened forms without claiming the 20-form gold gate", async () => {
  const cases = await Promise.all(
    fixtures.flatForms.map(async (name, index) => {
      const bytes = await readForm(name);
      return {
        id: `svbox-flat-${index + 1}`,
        bytes: await flatten(bytes),
        gold: (await widgetGold(bytes)).map(
          (field): EvaluationField => ({
            box: field.box,
            label_de: field.name,
            owner: "applicant",
          }),
        ),
      };
    }),
  );
  const registry = new Registry();
  registerE13(
    registry,
    cases.map(({ id, gold }) => ({
      id,
      tags: ["pr"],
      input: { fixture: id },
      gold,
      source: {
        uri: `urn:svbox:${id}`,
        passage:
          "Original AcroForm widget rectangles; labels are field names and owners are unreviewed fixture annotations.",
      },
    })),
    async (input, { signal }) => {
      const parsed = z.object({ fixture: z.string() }).parse(input);
      const source = cases.find((item) => item.id === parsed.fixture);
      if (!source) throw new Error("Unknown fixture");
      return (await detectFields(source.bytes, { vision: "disabled", signal })).fields;
    },
  );
  const result = await runSuite(registry.get("E13"), {
    modelVersion: "pdfjs-vector-v1",
    gitSha: "a".repeat(40),
  });
  expect(result.counts.total).toBe(3);
  expect(result.counts.errors).toBe(0);
  expect(result.metrics.boxRecall).toBeGreaterThanOrEqual(0.8);
  expect(result.suite.gate.kind).toBe("informational");
  expect(result.gateVerdict).toBe("insufficient_data");
});
