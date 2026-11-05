import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { measureFields } from "../../../../evals/src/e13/metrics.ts";
import { DraftFormSchema, detectFields } from "../../../src/forms/detect/index.ts";
import fixtures from "./fixtures.json";
import { flatten, formNames, readForm, widgetGold } from "./fixtures.ts";

describe("FR-D11 AcroForm detection", async () => {
  const names = await formNames();
  test("AC1 the source set contains all seven fillable forms", () => {
    expect(names).toHaveLength(7);
  });
  test.each(names)("AC1 preserves every widget and its checkbox/text type: %s", async (name) => {
    const bytes = await readForm(name);
    const gold = await widgetGold(bytes);
    expect(gold.length).toBeGreaterThan(0);
    const draft = await detectFields(bytes, { mode: "acroform", vision: "disabled" });
    expect(DraftFormSchema.parse(draft)).toEqual(draft);
    const widgets = draft.fields.filter((field) => field.method === "acroform");
    expect(draft.fields).toHaveLength(gold.length);
    expect(widgets).toHaveLength(gold.length);
    expect(new Set(widgets.map((field) => field.id)).size).toBe(widgets.length);
    for (const expected of gold) {
      const found = widgets.find(
        (field) =>
          field.acro_field === expected.name &&
          field.box.page === expected.box.page &&
          Math.abs(field.box.x - expected.box.x) < 0.1 &&
          Math.abs(field.box.y - expected.box.y) < 0.1,
      );
      expect(found, expected.name).toBeDefined();
      if (expected.type !== "other") expect(found?.type).toBe(expected.type);
      expect(found?.box.width).toBeCloseTo(expected.box.width, 1);
      expect(found?.box.height).toBeCloseTo(expected.box.height, 1);
    }
  });
});

test.each(fixtures.flatForms)("AC2 flat recall reaches 0.8 at IoU 0.5: %s", async (name) => {
  const bytes = await readForm(name);
  const gold = await widgetGold(bytes);
  const draft = await detectFields(await flatten(bytes), { vision: "disabled" });
  expect(draft.fields.every((field) => field.acro_field === undefined)).toBe(true);
  const metrics = measureFields(
    draft.fields,
    gold.map((field) => ({ ...field, label_de: field.name, owner: "applicant" })),
  );
  expect(metrics.boxRecall, JSON.stringify(metrics)).toBeGreaterThanOrEqual(0.8);
});

test("AC3 rehabilitation doctor fields retain doctor ownership through flattening", async () => {
  const bytes = await readForm(fixtures.flatForms[0] ?? "");
  for (const input of [bytes, await flatten(bytes)]) {
    const draft = await detectFields(input, { vision: "disabled" });
    const doctorFields = draft.fields.filter((field) => field.box.page === 2 && field.box.y < 590);
    expect(doctorFields.length).toBeGreaterThan(20);
    expect(doctorFields.every((field) => field.owner === "doctor")).toBe(true);
    const officeFields = draft.fields.filter((field) => field.box.page === 2 && field.box.y > 640);
    expect(officeFields.length).toBeGreaterThan(0);
    expect(officeFields.every((field) => field.owner === "office")).toBe(true);
  }
});

test("FR-D11 incomplete AcroForms include unduplicated flat fields with nearby labels", async () => {
  // Test-only layout exercises an incomplete field set the original forms do not provide.
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Name", { x: 20, y: 350, size: 10 });
  document
    .getForm()
    .createTextField("person")
    .addToPage(page, { x: 100, y: 344, width: 160, height: 16 });
  page.drawText("Datum", { x: 20, y: 300, size: 10 });
  page.drawRectangle({ x: 100, y: 294, width: 160, height: 16, borderWidth: 1 });
  page.drawText("Zustimmung", { x: 120, y: 250, size: 10 });
  page.drawRectangle({ x: 100, y: 248, width: 10, height: 10, borderWidth: 1 });
  const draft = await detectFields(await document.save(), { vision: "disabled" });
  expect(draft.fields).toHaveLength(3);
  expect(draft.fields.find((field) => field.type === "date")?.label_de).toBe("Datum");
  expect(draft.fields.find((field) => field.type === "checkbox")?.label_de).toBe("Zustimmung");
});

test("FR-D11 boxes use the rotated crop viewport and retain the caller's bytes", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.setCropBox(20, 30, 300, 400);
  page.setRotation(degrees(90));
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText("Name", { x: 50, y: 420, size: 10, font });
  document
    .getForm()
    .createTextField("person")
    .addToPage(page, { x: 50, y: 300, width: 100, height: 20, borderWidth: 0 });
  const bytes = await document.save();
  const original = bytes.slice();
  const draft = await detectFields(bytes, { vision: "disabled" });
  expect(bytes).toEqual(original);
  expect(draft.pages[0]).toMatchObject({ width: 400, height: 300 });
  expect(draft.fields.find((field) => field.acro_field === "person")?.box).toEqual({
    page: 1,
    x: 270,
    y: 30,
    width: 20,
    height: 100,
  });
});

test("FR-D11 rejects invalid PDFs and honours a cancelled detection", async () => {
  await expect(detectFields(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
    code: "invalid_pdf",
  });
  await expect(
    detectFields(await readForm(fixtures.flatForms[0] ?? ""), { signal: AbortSignal.abort() }),
  ).rejects.toThrow();
});
