import { expect, it } from "vitest";
import { fieldOwner, sectionHeaders } from "../../../src/forms/detect/text.ts";
import { reconcileFormFields } from "../../../src/forms/registry/reconcile.ts";
import type { FormField } from "../../../src/forms/schema.ts";

const field: FormField = {
  id: "mapped",
  label_de: "Name",
  type: "text",
  page: 1,
  owner: "applicant",
  signature: "none",
  method: "acroform",
  confidence: 1,
  validation: {},
  fact_type: "person.name",
  acro_field: "native-name",
};

it("keeps one catalog mapping for repeated widgets and preserves undetected mappings", () => {
  const hidden = { ...field, id: "undetected", acro_field: "other" };
  const detected = [1, 2].map((page) => ({ ...field, id: `widget-${page}`, page }));
  expect(reconcileFormFields([field, hidden], detected)).toEqual([field, hidden]);
});

it("protects every widget of a shared provider value without relaxing existing ownership", () => {
  const provider = { ...field, id: "widget", owner: "doctor" as const, page: 2 };
  expect(reconcileFormFields([field], [field, provider])[0]?.owner).toBe("doctor");
  expect(reconcileFormFields([provider], [field])[0]?.owner).toBe("doctor");
});

it("recognizes the applicant declaration after a provider confirmation section", () => {
  const headers = sectionHeaders([
    {
      text: "VON DER EINRICHTUNG/VOM BEHANDLER AUSZUFÜLLEN",
      box: { page: 1, x: 10, y: 100, width: 500, height: 12 },
    },
    {
      text: "Ich bestätige, dass die Angaben richtig sind, und dass ich von der Rezeptgebühr befreit bin.",
      box: { page: 1, x: 10, y: 200, width: 500, height: 12 },
    },
  ]);
  expect(fieldOwner(150, headers, "applicant")).toBe("hospital");
  expect(fieldOwner(220, headers, "hospital")).toBe("applicant");
});
