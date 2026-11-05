import { PDFDocument } from "pdf-lib";
import { expect, test } from "vitest";
import { detectFields } from "../../../src/forms/detect/index.ts";
import { inferType } from "../../../src/forms/detect/text.ts";
import { flatten } from "./fixtures.ts";

test("FR-D11 types distinguish dates, numbers, signatures and square checkboxes", () => {
  expect(inferType("TT.MM.JJJJ")).toBe("date");
  expect(inferType("Datum")).toBe("date");
  expect(inferType("Anzahl")).toBe("number");
  expect(inferType("Unterschrift")).toBe("signature");
  expect(inferType("Zustimmung", true)).toBe("checkbox");
  expect(inferType("Name")).toBe("text");
});

test("FR-D11 section ownership persists across pages and resets at the next explicit header", async () => {
  // Test-only layout covers multi-page owner transitions absent from the small gold set.
  const document = await PDFDocument.create();
  const headers = [
    "Vom Arzt auszufüllen",
    undefined,
    "Von der Krankenanstalt auszufüllen",
    "Vom Versicherungsträger auszufüllen",
    "Vom Antragsteller auszufüllen",
  ];
  for (const [index, header] of headers.entries()) {
    const page = document.addPage([400, 400]);
    if (header) page.drawText(header, { x: 20, y: 370, size: 10 });
    if (index === 0)
      document
        .getForm()
        .createTextField("page-identifier")
        .addToPage(page, { x: 270, y: 380, width: 100, height: 15 });
    page.drawText("Name", { x: 20, y: 310, size: 10 });
    document
      .getForm()
      .createTextField(`entry-${index}`)
      .addToPage(page, { x: 100, y: 300, width: 150, height: 20 });
  }
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(result.fields.find((field) => field.acro_field === "page-identifier")?.owner).toBe(
    "doctor",
  );
  expect(
    result.fields
      .filter((field) => field.acro_field?.startsWith("entry-"))
      .map((field) => field.owner),
  ).toEqual(["doctor", "doctor", "hospital", "office", "applicant"]);
});

test.each(
  [
    { owner: "doctor", heading: "Vom   Arzt" },
    { owner: "hospital", heading: "Von der  Krankenanstalt" },
  ].flatMap((section) => ["acroform", "flat"].map((mode) => ({ ...section, mode }))),
)(
  "FR-D11 wrapped $owner headings set ownership in $mode detection",
  async ({ owner, heading, mode }) => {
    // Test-only layout covers wrapped medical headers absent from the original forms.
    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    page.drawText("Name", { x: 20, y: 340, size: 10 });
    document.getForm().createTextField("before").addToPage(page, {
      x: 100,
      y: 330,
      width: 150,
      height: 20,
    });
    page.drawText(heading, { x: 20, y: 280, size: 10 });
    page.drawText("auszufüllen", { x: 20, y: 266, size: 10 });
    page.drawText("Name", { x: 20, y: 225, size: 10 });
    document.getForm().createTextField("after").addToPage(page, {
      x: 100,
      y: 214,
      width: 150,
      height: 20,
    });
    const bytes = await document.save();
    const result = await detectFields(mode === "flat" ? await flatten(bytes) : bytes, {
      mode: mode === "flat" ? "auto" : "acroform",
      vision: "disabled",
    });

    expect(result.fields).toHaveLength(2);
    expect(result.fields.map((field) => field.owner)).toEqual(["applicant", owner]);
  },
);

test("FR-D11 flat detection finds underscores, dotted rules and combs without inventing checkbox cells", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Name: __________________", { x: 20, y: 340, size: 10 });
  page.drawText("Unterschrift", { x: 20, y: 280, size: 10 });
  page.drawLine({
    start: { x: 110, y: 278 },
    end: { x: 280, y: 278 },
    dashArray: [1, 2],
    thickness: 0.5,
  });
  page.drawText("Nummer", { x: 20, y: 220, size: 10 });
  for (let i = 0; i < 10; i++)
    page.drawRectangle({ x: 100 + i * 12, y: 215, width: 12, height: 15, borderWidth: 0.5 });
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(
    result.fields.some((field) => field.method === "text" && field.label_de.includes("Name")),
  ).toBe(true);
  expect(result.fields.some((field) => field.type === "signature")).toBe(true);
  const combs = result.fields.filter((field) => field.label_de === "Nummer");
  expect(combs).toHaveLength(1);
  expect(combs[0]?.type).toBe("number");
  expect(combs[0]?.box.width).toBeGreaterThan(110);
});

test.each([
  { order: "reversed", cells: [4, 3, 2, 1, 0] },
  { order: "shuffled", cells: [2, 0, 4, 1, 3] },
])("FR-D11 comb fields are identical under $order drawing order", async ({ cells }) => {
  // Test-only layouts vary PDF drawing order while preserving the same visible cells.
  const detectComb = async (order: readonly number[]) => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    page.drawText("Nummer", { x: 20, y: 220, size: 10 });
    for (const index of order)
      page.drawRectangle({ x: 100 + index * 12, y: 215, width: 12, height: 12, borderWidth: 0.5 });
    return detectFields(await document.save(), { vision: "disabled" });
  };
  const expected = await detectComb([0, 1, 2, 3, 4]);
  expect(expected.fields).toEqual([
    expect.objectContaining({
      label_de: "Nummer",
      type: "number",
      box: { page: 1, x: 100, y: 173, width: 60, height: 12 },
    }),
  ]);
  expect(await detectComb(cells)).toEqual(expected);
});
