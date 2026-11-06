import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { expect, test } from "vitest";
import { z } from "zod";
import { statementCandidates } from "../../src/documents/candidates.ts";
import { groundStatements, locateQuote } from "../../src/documents/extraction.ts";
import * as pagesModule from "../../src/documents/pages.ts";
import { documentPagesSchema } from "../../src/documents/schema.ts";
import { documentSections } from "../../src/documents/sections.ts";
import { dischargePdf } from "./fixture.ts";

test("FR-D2 reads all seven real discharge pages with normalized source line boxes", async () => {
  const pages = await pagesModule.readDocumentPages(await dischargePdf());
  expect(pages).toHaveLength(7);
  expect(documentPagesSchema.parse(pages)).toEqual(pages);
  expect(pages.every((page) => page.method === "text_layer" && page.lines.length > 0)).toBe(true);
  expect(pages.map((page) => page.text).join("\n")).toContain("Rehabilitation");
  for (const page of pages)
    for (const line of page.lines) {
      expect(line.bbox.width).toBeGreaterThan(0);
      expect(line.bbox.height).toBeGreaterThan(0);
      expect(line.bbox.x + line.bbox.width).toBeLessThanOrEqual(1.000001);
      expect(line.bbox.y + line.bbox.height).toBeLessThanOrEqual(1.000001);
    }
});

test("E12 preserves every annotated discharge source span across medication, care and continuation tables", async () => {
  const data = z
    .object({
      cases: z.array(
        z.object({
          id: z.string(),
          expected: z.object({
            annotations: z.array(z.object({ page: z.number(), quote: z.string() })),
          }),
        }),
      ),
    })
    .parse(
      JSON.parse(
        await readFile(new URL("../../../evals/sets/e12/gold.json", import.meta.url), "utf8"),
      ),
    );
  const annotations = data.cases.find((item) => item.id === "e12-svbox-discharge")?.expected
    .annotations;
  if (!annotations) throw new Error("Missing source annotations");
  const pages = await pagesModule.readDocumentPages(await dischargePdf());
  const candidates = documentSections(pages).flatMap((sectioned) =>
    statementCandidates(sectioned).map((candidate) => ({
      ...candidate,
      page: sectioned.page.page,
    })),
  );
  const compact = (text: string): string => text.replace(/\s/gu, "");
  expect(annotations).toHaveLength(37);
  for (const annotation of annotations) {
    expect(
      candidates.some(
        (candidate) =>
          candidate.page === annotation.page &&
          (candidate.kind === "field"
            ? compact(candidate.text).includes(compact(annotation.quote))
            : compact(candidate.text) === compact(annotation.quote)),
      ),
      annotation.quote,
    ).toBe(true);
  }
});

test("FR-D3 rejects paraphrased and wrong-page model statements and computes source boxes", async () => {
  const pages = await pagesModule.readDocumentPages(await dischargePdf());
  const page = pages.find((page) => page.text.includes("Rehabilitation"));
  const line = page?.lines.find((line) => line.text.includes("Rehabilitation"));
  if (!page || !line) throw new Error("Fixture recommendation absent");
  const result = groundStatements(
    { statements: [{ type: "documented_recommendation", quote: line.text, page: page.page }] },
    pages,
  );
  expect(result[0]?.quote).toBe(line.text);
  expect(result[0]?.bbox).toEqual(locateQuote(page, line.text));
  expect(() =>
    groundStatements(
      {
        statements: [
          {
            type: "documented_recommendation",
            quote: "Eine frei erfundene Empfehlung.",
            page: page.page,
          },
        ],
      },
      pages,
    ),
  ).toThrow("ungrounded_statement");
  expect(() =>
    groundStatements(
      { statements: [{ type: "administrative_fact", quote: line.text, page: 999 }] },
      pages,
    ),
  ).toThrow("ungrounded_statement");
});

test("FR-D2 uses rotated CropBox coordinates for text layer positions", async () => {
  // A generated fixture exercises a rotation absent from the challenge letter.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  page.setCropBox(50, 100, 500, 650);
  page.setRotation(degrees(90));
  page.drawText("Ausstellungsdatum: 06.11.2026", {
    x: 80,
    y: 650,
    font: await pdf.embedFont(StandardFonts.Helvetica),
    size: 12,
  });
  const result = await pagesModule.readDocumentPages(await pdf.save());
  expect(result[0]).toMatchObject({ width: 650, height: 500, method: "text_layer" });
  expect(result[0]?.lines[0]?.bbox.x).toBeGreaterThan(0.8);
});

test("FR-D2 groups offset table cells in visual order and grounds only the selected row", async () => {
  // Generated from the challenge table layout to exercise offset baselines and PDF draw order.
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Sozialberatung", { x: 300, y: 697, size: 12, font });
  page.drawText("Weitere Aufgabe", { x: 60, y: 670, size: 12, font });
  page.drawText("Antrag vorbereiten", { x: 60, y: 700, size: 12, font });
  const pages = await pagesModule.readDocumentPages(await pdf.save());
  expect(pages[0]?.lines.map((line) => line.text)).toEqual([
    "Antrag vorbereiten Sozialberatung",
    "Weitere Aufgabe",
  ]);
  const first = pages[0];
  if (!first) throw new Error("Missing generated page");
  const box = locateQuote(first, "Antrag vorbereiten Sozialberatung");
  expect(box).toEqual(first.lines[0]?.bbox);
  expect(box.y + box.height).toBeLessThan(first.lines[1]?.bbox.y ?? 0);
});

test("FR-D2 rejects unsupported and invalid originals", async () => {
  await expect(
    pagesModule.readDocumentPages(new TextEncoder().encode("not a document")),
  ).rejects.toMatchObject({ code: "unsupported_file" });
  await expect(
    pagesModule.readDocumentPages(new TextEncoder().encode("%PDF-invalid")),
  ).rejects.toMatchObject({ code: "invalid_pdf" });
});

test("FR-D3 restores source whitespace without paraphrasing a medical quotation", () => {
  const page = {
    page: 1,
    width: 600,
    height: 800,
    method: "text_layer" as const,
    text: "Empfehlung: Prüfung einer\nRehabilitation.",
    lines: [
      { text: "Empfehlung: Prüfung einer", bbox: { x: 0.1, y: 0.2, width: 0.4, height: 0.02 } },
      { text: "Rehabilitation.", bbox: { x: 0.1, y: 0.23, width: 0.3, height: 0.02 } },
    ],
  };
  const [statement] = groundStatements(
    {
      statements: [
        {
          type: "documented_recommendation",
          quote: "Empfehlung: Prüfung einer Rehabilitation.",
          page: 1,
        },
      ],
    },
    [page],
  );
  expect(statement?.quote).toBe(page.text);
  expect(statement?.bbox.height).toBeCloseTo(0.05);
  expect(() =>
    groundStatements(
      {
        statements: [
          {
            type: "documented_recommendation",
            quote: "Empfehlung: sofortige Rehabilitation.",
            page: 1,
          },
        ],
      },
      [page],
    ),
  ).toThrow("ungrounded_statement");
});

import { readFile } from "node:fs/promises";
