import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { extractDocumentStatements } from "../../src/documents/extraction.ts";
import { readDocumentPages } from "../../src/documents/pages.ts";
import { renderPdfPage } from "../../src/forms/detect/vision.ts";
import { dischargePdf } from "./fixture.ts";

test("E12 extracts grounded verbatim recommendations from the real seven-page discharge PDF", async () => {
  const pages = await readDocumentPages(await dischargePdf());
  const statements = await extractDocumentStatements(pages);
  expect(statements.length).toBeGreaterThan(0);
  expect(
    statements.some(
      (statement) =>
        statement.type === "documented_recommendation" &&
        statement.quote.includes("Rehabilitation"),
    ),
  ).toBe(true);
  expect(statements.some((statement) => statement.type === "administrative_fact")).toBe(true);
  for (const statement of statements) {
    const page = pages.find((page) => page.page === statement.page);
    expect(page?.text.includes(statement.quote)).toBe(true);
    expect(statement.bbox.width).toBeGreaterThan(0);
    expect(statement.bbox.height).toBeGreaterThan(0);
    expect(statement.quote).not.toMatch(/ICD-10|C18\.|I10|E86|G3|mg\s+(?:1|0)[-–]/u);
  }
}, 180000);

test("FR-D2 real vision OCR reads a rasterized discharge page and returns positioned German lines", async () => {
  const original = await dischargePdf();
  const image = await renderPdfPage(original, 1);
  const pages = await readDocumentPages(image);
  expect(pages[0]?.method).toBe("vision");
  expect(pages[0]?.text).toContain("Entlassung");
  expect(pages[0]?.lines.length).toBeGreaterThan(5);
}, 180000);

test("FR-D2 automatically uses vision for an image-only PDF", async () => {
  // Rasterization of the original creates a scanned fixture without modifying source files.
  const image = await renderPdfPage(await dischargePdf(), 5);
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPng(image);
  pdf
    .addPage([embedded.width, embedded.height])
    .drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  const pages = await readDocumentPages(await pdf.save());
  expect(pages[0]?.method).toBe("vision");
  expect(pages[0]?.text).toContain("Rehabilitation");
  expect(pages[0]?.lines.length).toBeGreaterThan(5);
}, 180000);
