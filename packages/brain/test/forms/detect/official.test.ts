import { readFile } from "node:fs/promises";
import { degrees, PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import gold from "../../../../evals/sets/e13/gold.json";
import { EvaluationFieldSchema, measureFields } from "../../../../evals/src/e13/metrics.ts";
import { overlap } from "../../../src/forms/detect/geometry.ts";
import { detectFields } from "../../../src/forms/detect/index.ts";

const setRoot = new URL("../../../../evals/sets/e13/", import.meta.url);

test("FR-D11 official flat forms retain at least 90% pooled answer-box recall", async () => {
  // The untouched source-backed gold is used only by this test, never by product detection.
  let matched = 0;
  let total = 0;
  for (const item of gold.cases) {
    const bytes = new Uint8Array(await readFile(new URL(item.input.document.path, setRoot)));
    const draft = await detectFields(bytes, { vision: "disabled" });
    const metrics = measureFields(draft.fields, EvaluationFieldSchema.array().parse(item.expected));
    matched += metrics.boxMatchedCount;
    total += metrics.goldCount;
  }
  expect(matched / total).toBeGreaterThanOrEqual(0.9);
});

test.each(["svs-004", "svs-049", "svs-125"])(
  "FR-D11 actual font outlines detect check squares even with broken Unicode maps: %s",
  async (file) => {
    const item = gold.cases.find((item) => item.input.document.path.endsWith(`${file}.pdf`));
    expect(item).toBeDefined();
    if (!item) return;
    const draft = await detectFields(
      new Uint8Array(await readFile(new URL(item.input.document.path, setRoot))),
      { vision: "disabled" },
    );
    const squares = item.expected.filter((field) => field.type === "checkbox");
    expect(squares.length).toBeGreaterThan(0);
    const matched = squares.filter((expected) =>
      draft.fields.some(
        (actual) => actual.type === "checkbox" && overlap(actual.box, expected.box) >= 0.5,
      ),
    );
    expect(matched.length / squares.length).toBeGreaterThanOrEqual(0.85);
  },
);

test.each([
  { rotation: 0, box: { x: 30, y: 110, width: 100, height: 20 } },
  { rotation: 90, box: { x: 270, y: 30, width: 20, height: 100 } },
  { rotation: 180, box: { x: 170, y: 270, width: 100, height: 20 } },
  { rotation: 270, box: { x: 110, y: 170, width: 20, height: 100 } },
])(
  "FR-D11 flat answer boxes preserve CropBox and $rotation degree display rotation",
  async ({ rotation, box }) => {
    // A constructed test layout isolates the coordinate cases the official set does not contain.
    const document = await PDFDocument.create();
    const page = document.addPage([400, 500]);
    page.setCropBox(20, 30, 300, 400);
    page.setRotation(degrees(rotation));
    page.drawText("Name", { x: 50, y: 326, size: 8 });
    page.drawRectangle({ x: 50, y: 300, width: 100, height: 20, borderWidth: 0.5 });
    const draft = await detectFields(await document.save(), { vision: "disabled" });
    expect(draft.fields).toHaveLength(1);
    expect(draft.fields[0]).toMatchObject({ label_de: "Name", box: { page: 1, ...box } });
  },
);
