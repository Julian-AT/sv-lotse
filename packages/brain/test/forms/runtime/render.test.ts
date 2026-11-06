import { degrees, PDFDocument, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectFields } from "../../../src/forms/detect/index.ts";
import { renderFormPdf } from "../../../src/forms/output/render.ts";
import type { FormSchema } from "../../../src/forms/schema.ts";
import { flatten, formNames, readForm } from "../detect/fixtures.ts";

async function original() {
  for (const name of await formNames()) {
    const bytes = await readForm(name);
    const document = await PDFDocument.load(bytes);
    if (
      document
        .getForm()
        .getFields()
        .some((field) => field instanceof PDFTextField)
    )
      return bytes;
  }
  throw new Error("No official text-field form available");
}

describe("FR-D6 real PDF output", () => {
  it("leaves a shared native field blank when one widget belongs to a provider", async () => {
    // Test-only ownership collision: AcroForm widgets share one underlying value.
    const document = await PDFDocument.create();
    const page = document.addPage();
    const shared = document.getForm().createTextField("shared");
    shared.addToPage(page, { x: 10, y: 100, width: 100, height: 20 });
    shared.addToPage(page, { x: 10, y: 200, width: 100, height: 20 });
    const fields: FormSchema["fields"] = ["applicant", "doctor"].map((id) => ({
      id,
      label_de: "Name",
      type: "text",
      page: 1,
      acro_field: "shared",
      owner: id === "doctor" ? "doctor" : "applicant",
      signature: "none",
      method: "acroform",
      confidence: 1,
      validation: {},
    }));
    const schema: FormSchema = { templateId: "test-template", status: "auto", fields };
    const result = await PDFDocument.load(
      await renderFormPdf(await document.save(), schema, {
        applicant: {
          value: "Beispiel",
          provenance: {},
          state: "confirmed",
          approvalId: "test-approval",
        },
      }),
    );
    expect(result.getForm().getTextField("shared").getText()).toBeUndefined();
  });
  it("fills confirmed AcroForm values and clears pre-existing values and drafts", async () => {
    const bytes = await original();
    const detected = await detectFields(bytes, { mode: "acroform", vision: "disabled" });
    const applicant = detected.fields.find(
      (field) => field.owner === "applicant" && field.type === "text",
    );
    if (!applicant?.acro_field) throw new Error("No applicant field");
    const schema: FormSchema = {
      templateId: "test-template",
      status: "auto",
      fields: detected.fields.map((field) => ({ ...field, page: field.box.page, validation: {} })),
    };
    const fields = {
      [applicant.id]: {
        value: "Ada Beispiel",
        provenance: { source: { kind: "statement", quote: "Ada Beispiel" } },
        state: "draft",
        approvalId: null,
      },
    };
    const draft = await PDFDocument.load(await renderFormPdf(bytes, schema, fields));
    expect(draft.getForm().getTextField(applicant.acro_field).getText()).toBeUndefined();
    const confirmed = await PDFDocument.load(
      await renderFormPdf(bytes, schema, {
        [applicant.id]: {
          ...fields[applicant.id],
          state: "confirmed",
          approvalId: "test-approval",
        },
      }),
    );
    expect(confirmed.getForm().getTextField(applicant.acro_field).getText()).toBe("Ada Beispiel");
    const blocked = {
      ...schema,
      fields: schema.fields.map((field) => ({ ...field, owner: "doctor" as const })),
    };
    const doctor = await PDFDocument.load(
      await renderFormPdf(bytes, blocked, {
        [applicant.id]: {
          ...fields[applicant.id],
          state: "confirmed",
          approvalId: "test-approval",
        },
      }),
    );
    expect(doctor.getForm().getTextField(applicant.acro_field).getText()).toBeUndefined();
  });
  it("adds an editable detected field to a genuinely flattened SV-Box PDF", async () => {
    const bytes = await flatten(await original());
    const detected = await detectFields(bytes, { vision: "disabled" });
    const applicant = detected.fields.find(
      (field) => field.owner === "applicant" && field.type === "text",
    );
    if (!applicant) throw new Error("No detected applicant field");
    const schema: FormSchema = {
      templateId: "test-template",
      status: "auto",
      fields: [{ ...applicant, page: applicant.box.page, validation: {} }],
    };
    const rendered = await PDFDocument.load(
      await renderFormPdf(bytes, schema, {
        [applicant.id]: {
          value: "Beispiel",
          provenance: {},
          state: "confirmed",
          approvalId: "test-approval",
        },
      }),
    );
    expect(rendered.getForm().getTextField(`lotse.${applicant.id}`).getText()).toBe("Beispiel");
  });
  it.each([0, 90, 180, 270])(
    "places an added field in the displayed CropBox at rotation %s",
    async (rotation) => {
      // Test-only geometry fixture for rotations not all represented in the source forms.
      const document = await PDFDocument.create();
      const page = document.addPage([300, 400]);
      page.setCropBox(20, 30, 250, 330);
      page.setRotation(degrees(rotation));
      const box = { page: 1, x: 15, y: 20, width: 100, height: 22 };
      const schema: FormSchema = {
        templateId: "test-template",
        status: "auto",
        fields: [
          {
            id: "rotated-field",
            label_de: "Name",
            type: "text",
            page: 1,
            box,
            owner: "applicant",
            signature: "none",
            method: "vector",
            confidence: 1,
            validation: {},
          },
        ],
      };
      const rendered = await renderFormPdf(await document.save(), schema, {
        "rotated-field": {
          value: "Ada",
          provenance: {},
          state: "confirmed",
          approvalId: "test-approval",
        },
      });
      const result = await detectFields(rendered, { mode: "acroform", vision: "disabled" });
      expect(result.fields[0]?.box).toEqual(box);
    },
  );
});
