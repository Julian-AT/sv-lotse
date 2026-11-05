import { PDFDocument, PDFName } from "pdf-lib";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { detectFields } from "../../../src/forms/detect/index.ts";
import { detectVisionFields } from "../../../src/forms/detect/vision.ts";

// Isolated orchestration/error units only. AC4 uses real OpenAI in vision.live.test.ts.
const modelCall = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: modelCall,
}));

beforeEach(() => {
  modelCall.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
  vi.stubEnv("FORM_VISION_MODEL", "unit-test-model");
});
afterEach(() => vi.unstubAllEnvs());

test.each([
  { model: undefined, expected: "gpt-4.1-mini" },
  { model: "unit-test-model", expected: "unit-test-model" },
])(
  "FR-D11 vision selects $expected when FORM_VISION_MODEL is $model",
  async ({ model, expected }) => {
    vi.stubEnv("FORM_VISION_MODEL", model);
    const output = { fields: [], lastOwner: "applicant" };
    modelCall.mockResolvedValue({ output });

    await expect(detectVisionFields(new Uint8Array([1]), "applicant")).resolves.toEqual(output);
    expect(modelCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ modelId: expected }) }),
    );
  },
);

test("FR-D11 image-only pages with partial widgets still detect missing vision fields", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  document
    .getForm()
    .createTextField("existing")
    .addToPage(page, { x: 40, y: 300, width: 100, height: 20, borderWidth: 0 });
  modelCall.mockResolvedValue({
    output: {
      fields: [
        {
          label_de: "Name",
          type: "text",
          owner: "applicant",
          box: { x: 0.1, y: 0.2, width: 0.25, height: 0.05 },
        },
        {
          label_de: "Datum",
          type: "date",
          owner: "applicant",
          box: { x: 0.1, y: 0.4, width: 0.25, height: 0.05 },
        },
      ],
      lastOwner: "applicant",
    },
  });
  const result = await detectFields(await document.save());
  expect(modelCall).toHaveBeenCalledTimes(1);
  expect(result.fields).toHaveLength(2);
  expect(result.fields.find((field) => field.method === "vision")).toMatchObject({
    label_de: "Datum",
    confidence: 0.6,
    box: { page: 1, x: 40, y: 160, width: 100, height: 20 },
  });
  expect(result.fields.find((field) => field.method === "acroform")?.acro_field).toBe("existing");
});

test.each(["doctor", "hospital"] as const)(
  "FR-D11 scanned %s sections reconcile widget ownership and signature flags before deduplication",
  async (owner) => {
    // Test-only widgets cover scans with existing text/signature fields absent from the source set.
    const document = await PDFDocument.create();
    const page = document.addPage([400, 400]);
    const entry = document.getForm().createTextField("existing");
    entry.addToPage(page, { x: 40, y: 300, width: 100, height: 20, borderWidth: 0 });
    const signature = document.getForm().createTextField("signature");
    signature.addToPage(page, { x: 40, y: 220, width: 100, height: 20, borderWidth: 0 });
    signature.acroField.dict.set(PDFName.of("FT"), PDFName.of("Sig"));
    const bytes = await document.save({ updateFieldAppearances: false });
    const widgets = (await detectFields(bytes, { mode: "acroform" })).fields;
    expect(widgets.find((field) => field.type === "signature")?.signature).toBe("subject");
    modelCall.mockResolvedValue({
      output: {
        fields: [
          {
            label_de: "Name",
            type: "text",
            owner,
            box: { x: 0.1, y: 0.2, width: 0.25, height: 0.05 },
          },
          {
            label_de: "Unterschrift",
            type: "signature",
            owner,
            box: { x: 0.1, y: 0.4, width: 0.25, height: 0.05 },
          },
        ],
        lastOwner: owner,
      },
    });

    const result = await detectFields(bytes);

    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(result.fields).toEqual(widgets.map((field) => ({ ...field, owner, signature: "none" })));
  },
);

test("FR-D11 vision errors and out-of-bounds output expose only a safe error code", async () => {
  modelCall.mockRejectedValueOnce(new Error("provider body must remain private"));
  await expect(detectVisionFields(new Uint8Array([1]), "applicant")).rejects.toMatchObject({
    code: "vision_failed",
    message: "Form field detection failed: vision_failed",
  });
  modelCall.mockResolvedValueOnce({
    output: {
      fields: [
        {
          label_de: "Name",
          type: "text",
          owner: "doctor",
          box: { x: 0.9, y: 0.2, width: 0.2, height: 0.1 },
        },
      ],
      lastOwner: "doctor",
    },
  });
  await expect(detectVisionFields(new Uint8Array([1]), "doctor")).rejects.toMatchObject({
    code: "vision_failed",
  });
});

test("FR-D11 disabled vision and cancellation make no provider call", async () => {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const result = await detectFields(await document.save(), { vision: "disabled" });
  expect(result.fields).toEqual([]);
  await expect(
    detectVisionFields(new Uint8Array([1]), "applicant", AbortSignal.abort()),
  ).rejects.toThrow();
  expect(modelCall).not.toHaveBeenCalled();
});

test("FR-D11 a scan retaining a searchable footer still invokes vision", async () => {
  const source = await PDFDocument.create();
  const sourcePage = source.addPage([400, 400]);
  sourcePage.drawText("Name", { x: 30, y: 320, size: 10 });
  sourcePage.drawRectangle({ x: 100, y: 300, width: 150, height: 25, borderWidth: 1 });
  const { renderPdfPage } = await import("../../../src/forms/detect/vision.ts");
  const scan = await PDFDocument.create();
  const image = await scan.embedPng(await renderPdfPage(await source.save()));
  const page = scan.addPage([400, 400]);
  page.drawImage(image, { x: 0, y: 0, width: 400, height: 400 });
  page.drawText("Seite 1", { x: 30, y: 10, size: 8 });
  modelCall.mockResolvedValue({
    output: {
      fields: [
        {
          label_de: "Name",
          type: "text",
          owner: "applicant",
          box: { x: 0.25, y: 0.1875, width: 0.375, height: 0.0625 },
        },
      ],
      lastOwner: "applicant",
    },
  });

  const draft = await detectFields(await scan.save());

  expect(modelCall).toHaveBeenCalledTimes(1);
  expect(draft.fields).toEqual([
    expect.objectContaining({
      method: "vision",
      label_de: "Name",
      box: { page: 1, x: 100, y: 75, width: 150, height: 25 },
    }),
  ]);
});

test("FR-D11 sparse vector detection invokes vision on a text form and preserves the found field", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]);
  page.drawText("Name:", { x: 20, y: 340, size: 10 });
  page.drawRectangle({ x: 100, y: 330, width: 150, height: 20, borderWidth: 0.5 });
  page.drawText("Anschrift:", { x: 20, y: 280, size: 10 });
  page.drawText("Telefon:", { x: 20, y: 220, size: 10 });
  modelCall.mockResolvedValue({
    output: {
      fields: [
        {
          label_de: "Name",
          type: "text",
          owner: "doctor",
          box: { x: 0.25, y: 0.125, width: 0.375, height: 0.05 },
        },
        {
          label_de: "Anschrift",
          type: "text",
          owner: "doctor",
          box: { x: 0.25, y: 0.275, width: 0.375, height: 0.05 },
        },
      ],
      lastOwner: "doctor",
    },
  });
  const result = await detectFields(await document.save());
  expect(modelCall).toHaveBeenCalledTimes(1);
  expect(result.fields).toHaveLength(2);
  expect(result.fields.find((field) => field.method === "vector")).toMatchObject({
    label_de: "Name",
    owner: "doctor",
  });
  expect(result.fields.find((field) => field.method === "vision")?.label_de).toBe("Anschrift");
});

test("FR-D11 instruction-only continuation pages do not invoke sparse-form vision", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  // Constructed prose exceeds the sparse-form budget while retaining punctuation like a real instruction page.
  for (let index = 0; index < 30; index++)
    page.drawText(
      "Hinweis: Lesen Sie die Angaben auf dieser Seite und beachten Sie die gedruckten Hinweise.",
      { x: 20, y: 760 - index * 20, size: 8 },
    );
  const result = await detectFields(await document.save());
  expect(result.fields).toEqual([]);
  expect(modelCall).not.toHaveBeenCalled();
});
