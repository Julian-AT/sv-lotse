import { expect, test } from "vitest";
import {
  AllowlistSchema,
  BenefitSchema,
  ConditionSchema,
  FacilitySchema,
  FormSchema,
  OfficeSchema,
  ProcessSchema,
  SourceRefSchema,
} from "../../src/schemas/index.ts";
import {
  allowlist,
  benefit,
  facility,
  form,
  office,
  processRecord,
  source,
} from "../loader/fixtures.ts";

test.each([
  [BenefitSchema, benefit],
  [ProcessSchema, processRecord],
  [OfficeSchema, office],
  [FacilitySchema, facility],
  [FormSchema, form],
  [AllowlistSchema, allowlist],
  [SourceRefSchema, source],
])("AC1 validates every record schema", (schema, record) => {
  expect(schema.safeParse(record).success).toBe(true);
});
test.each([
  "age >= 18",
  'not (retired or residence.state != "Wien")',
  "active and count < 3.5",
  "answer == null",
  "age > -1",
  "eligible",
])("NFR-13 accepts condition syntax %s", (condition) => {
  expect(ConditionSchema.safeParse(condition).success).toBe(true);
});
test.each([
  "",
  "age => 18",
  "age >=",
  "age == 18 trailing",
  "fn(age)",
  "age + 1",
  "(active",
  "active and",
  'age == "unterminated',
  "a < b < c",
])("NFR-13 rejects invalid conditions %s", (condition) => {
  expect(ConditionSchema.safeParse(condition).success).toBe(false);
});
test("NFR-13 rejects typos and incomplete field mappings", () => {
  expect(BenefitSchema.safeParse({ ...benefit, typo: true }).success).toBe(false);
  expect(
    FormSchema.safeParse({ ...form, fields: [{ ...form.fields[0], acro_field: undefined }] })
      .success,
  ).toBe(false);
  expect(SourceRefSchema.safeParse({ ...source, quote: "  " }).success).toBe(false);
});
test("NFR-13 rejects broken process-local dependencies and transitions", () => {
  expect(
    ProcessSchema.safeParse({ ...processRecord, steps: [{ id: "one", needs: ["missing"] }] })
      .success,
  ).toBe(false);
  expect(
    ProcessSchema.safeParse({
      ...processRecord,
      steps: [{ id: "one", needs: [], transitions: [{ to: "missing" }] }],
    }).success,
  ).toBe(false);
});

test.each([
  [BenefitSchema, benefit],
  [ProcessSchema, processRecord],
  [OfficeSchema, office],
  [FacilitySchema, facility],
  [FormSchema, form],
  [AllowlistSchema, allowlist],
])("AC1 rejects records without a source quote or as_of for every schema", (schema, record) => {
  expect(schema.safeParse({ ...record, sources: [{ ...source, quote: "" }] }).success).toBe(false);
  expect(schema.safeParse({ ...record, as_of: undefined }).success).toBe(false);
});

test("AC1 represents email appointment channels with the PRD url field", () => {
  expect(
    BenefitSchema.safeParse({
      ...benefit,
      appointment_channels: [
        { kind: "email", url: "mailto:service@example.org", verified_at: "2026-11-02" },
      ],
    }).success,
  ).toBe(true);
});
