import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { detectFields } from "../../../src/forms/detect/index.ts";
import { INSURANCE_NUMBER, templateSchema } from "../../../src/forms/schema.ts";
import { formNames, readForm } from "../detect/fixtures.ts";

describe("SV-Box registry contract", () => {
  it("normalizes every official form and protects shared provider widgets except the insurance number", async () => {
    for (const name of await formNames()) {
      const bytes = await readForm(name);
      const draft = await detectFields(bytes, { mode: "acroform", vision: "disabled" });
      const schema = templateSchema({
        id: randomUUID(),
        publisher: "SV-Box",
        title: name,
        source: `data/svbox/Anträge und Formulare/${name}`,
        hash: createHash("sha256").update(bytes).digest("hex"),
        versionDate: null,
        retrievedAt: new Date(),
        createdAt: new Date(),
        format: "acroform",
        pages: draft.pages.length,
        status: "auto",
        schema: JSON.parse(JSON.stringify(draft)),
        storageKey: "test-local-original",
      });
      expect(schema.fields).toHaveLength(draft.fields.length);
      for (const provider of draft.fields.filter((field) => field.owner !== "applicant")) {
        // The insured person's insurance number is identity data and stays with the applicant.
        const widgets = schema.fields.filter(
          (field) =>
            field.acro_field === provider.acro_field && !INSURANCE_NUMBER.test(field.label_de),
        );
        expect(widgets.every((field) => field.owner !== "applicant")).toBe(true);
      }
    }
  });
});
