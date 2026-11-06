import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import type { Candidate } from "../../../src/forms/detect/candidates.ts";
import { detectFields } from "../../../src/forms/detect/index.ts";
import {
  cleanLabel,
  columnLabel,
  contextualLabel,
  joinLabel,
} from "../../../src/forms/detect/labels.ts";
import type { TextRun } from "../../../src/forms/detect/text.ts";

// Constructed layouts isolate operator/layout variations without supplying product fixtures.
function run(text: string, x: number, y: number, width: number): TextRun {
  return { text, box: { page: 1, x, y, width, height: 10 } };
}

function cell(x: number, y: number, width: number, height: number): Candidate {
  return {
    box: { page: 1, x, y, width, height },
    checkbox: false,
    method: "vector",
    confidence: 0.85,
  };
}

test("FR-D11 wrapped labels preserve suspended compounds and short parenthetical names", () => {
  expect(cleanLabel("Familien- und Vorname")).toBe("Familien- und Vorname");
  expect(joinLabel([run("Einheitswert-", 10, 10, 70), run("aktenzeichen", 10, 21, 65)])).toBe(
    "Einheitswertaktenzeichen",
  );
  expect(joinLabel([run("Name der", 10, 10, 45), run("(des) Pächters", 10, 21, 65)])).toBe(
    "Name der (des) Pächters",
  );
});

test("FR-D11 repeated table rows use the closest full column caption", () => {
  const answer = cell(20, 200, 120, 30);
  const runs = [
    run("Frühere Angaben", 22, 20, 90),
    run("Familien- und", 22, 160, 80),
    run("Vorname", 22, 172, 45),
  ];
  expect(columnLabel(answer, [answer], runs)).toBe("Familien- und Vorname");
});

test("FR-D11 parallel checkbox groups select their own printed question", () => {
  const runs = [
    run("Körperl. oder geistige Behinderung", 20, 20, 170),
    run("Bezug von erhöhter Familienbeihilfe/Pflegegeld", 250, 20, 220),
  ];
  expect(contextualLabel("nein", cell(20, 40, 6, 6).box, runs, true)).toBe(
    "Körperl. oder geistige Behinderung – nein",
  );
  expect(contextualLabel("ja", cell(250, 40, 6, 6).box, runs, true)).toBe(
    "Bezug von erhöhter Familienbeihilfe/Pflegegeld – ja",
  );
});

test("FR-D11 repeated checkbox options retain the nearest document caption", () => {
  const runs = [run("Bestätigung der Schule", 20, 20, 130), run("Lehrvertrag", 20, 70, 65)];
  expect(contextualLabel("wird beigelegt", cell(20, 90, 6, 6).box, runs, true)).toBe(
    "Lehrvertrag – wird beigelegt",
  );
});

test("FR-D11 shading does not create rows of empty input fields", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Name", { x: 20, y: 300, size: 10 });
  for (let index = 0; index < 4; index++)
    page.drawRectangle({ x: 100, y: 270 + index * 10, width: 150, height: 10, borderWidth: 0 });
  expect((await detectFields(await document.save(), { vision: "disabled" })).fields).toEqual([]);
});

test("FR-D11 a serial number and date suffix with different character widths form one field", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Nummer", { x: 20, y: 290, size: 10 });
  for (let index = 0; index < 4; index++)
    page.drawRectangle({ x: 100 + index * 15, y: 280, width: 15, height: 20, borderWidth: 0.5 });
  for (let index = 0; index < 6; index++)
    page.drawRectangle({ x: 165 + index * 10, y: 280, width: 10, height: 20, borderWidth: 0.5 });
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]).toMatchObject({
    label_de: "Nummer",
    box: { x: 100, y: 100, width: 125, height: 20 },
  });
});

test("FR-D11 an inline date uses its printed line height rather than covering the previous row", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Datum: __________________", { x: 20, y: 250, size: 8 });
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]).toMatchObject({ type: "date", box: { y: 140, height: 10 } });
});

test("FR-D11 bottom captions leave the whole writing area above a signature", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawRectangle({ x: 50, y: 100, width: 200, height: 60, borderWidth: 0.5 });
  page.drawText("Unterschrift", { x: 55, y: 103, size: 10 });
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(result.fields).toHaveLength(1);
  expect(result.fields[0]?.type).toBe("signature");
  expect(result.fields[0]?.box.height).toBeGreaterThan(40);
});

test("FR-D11 text after a square glyph keeps placeholder advances relative to its trimmed box", async () => {
  const { textRuns } = await import("../../../src/forms/detect/text.ts");
  const runs = textRuns(
    {
      items: [
        {
          str: "X  Datum: __________",
          dir: "ltr",
          transform: [10, 0, 0, 10, 20, 100],
          width: 100,
          height: 10,
          fontName: "symbol",
          hasEOL: false,
        },
      ],
      styles: { symbol: { fontFamily: "sans", ascent: 0.8, descent: -0.2, vertical: false } },
      lang: "de",
    },
    [1, 0, 0, -1, 0, 400],
    1,
    new Map([
      [
        "symbol",
        new Map([
          ["X", { width: 0.7, square: [0, 0, 0.7, 0.7] }],
          [" ", { width: 0.25 }],
        ]),
      ],
    ]),
  );
  const label = runs.find((run) => run.text.startsWith("Datum"));
  expect(label?.advances?.[0]).toBe(0);
  expect(label?.advances?.at(-1)).toBeCloseTo(label?.box.width ?? 0);
});
