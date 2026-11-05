import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { DraftFormSchema, detectFields } from "../../../src/forms/detect/index.ts";
import { renderPdfPage } from "../../../src/forms/detect/vision.ts";
import fixtures from "./fixtures.json";
import { readForm } from "./fixtures.ts";

test("AC4 a real rasterized SV-Box page returns schema-valid vision fields", async () => {
  expect(process.env.RUN_LIVE).toBe("1");
  const bytes = await readForm(fixtures.flatForms[2] ?? "");
  const original = await PDFDocument.load(bytes);
  const source = original.getPage(0);
  const scanned = await PDFDocument.create();
  const image = await scanned.embedPng(await renderPdfPage(bytes));
  const page = scanned.addPage([source.getWidth(), source.getHeight()]);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  // No text operators or AcroForm survive: this exercises automatic scanned fallback.
  const result = await detectFields(await scanned.save());
  expect(DraftFormSchema.parse(result)).toEqual(result);
  expect(result.status).toBe("auto");
  expect(result.fields.length).toBeGreaterThan(0);
  expect(result.fields.every((field) => field.method === "vision" && field.confidence < 0.8)).toBe(
    true,
  );
}, 90_000);
