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
  SourceRegistrySchema,
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

const reviewableRecords = [
  [BenefitSchema, benefit],
  [ProcessSchema, processRecord],
  [OfficeSchema, office],
  [FacilitySchema, facility],
  [FormSchema, { ...form, status: "auto", verified_at: undefined }],
  [AllowlistSchema, allowlist],
  [SourceRegistrySchema, { sources: [source], as_of: "2026-11-01" }],
] as const;

test.each(reviewableRecords)(
  "WP-176 AC1 accepts records awaiting human review",
  (schema, record) => {
    expect(schema.safeParse({ ...record, verified_at: undefined }).success).toBe(true);
  },
);

test.each(reviewableRecords)("WP-176 AC1 rejects malformed review dates", (schema, record) => {
  for (const verified_at of [
    "not-a-date",
    "2026-02-30",
    "2026-1-02",
    "2026-11-02T12:00:00Z",
    null,
  ]) {
    expect(schema.safeParse({ ...record, verified_at }).success).toBe(false);
  }
});

test("WP-176 AC2 distinguishes candidate and verified form schemas", () => {
  const { verified_at, ...candidate } = form;
  expect(FormSchema.parse({ ...candidate, status: "auto" })).toEqual({
    ...candidate,
    status: "auto",
  });
  expect(FormSchema.safeParse(candidate).success).toBe(false);
  expect(FormSchema.safeParse({ ...candidate, status: "auto", verified_at }).success).toBe(false);
  expect(FormSchema.safeParse({ ...form, verified_at: "2026-02-30" }).success).toBe(false);
  expect(FormSchema.safeParse({ ...candidate, status: "draft" }).success).toBe(false);
  expect(FormSchema.parse(form)).toEqual(form);
});

test("WP-176 AC3 accepts simple office names and weekday hours quoted from the source", () => {
  // Synthetic administrative hours extend the existing fixture to cover the new fields.
  const opening_hours = {
    monday: "08:00–12:00 und 13:00–15:00",
    tuesday: "08:00–12:00",
    wednesday: "08:00–12:00",
    thursday: "08:00–12:00",
    friday: "08:00–12:00",
    saturday: "geschlossen",
    sunday: "geschlossen",
    notes: "Nur nach Terminvereinbarung.",
  };
  const record = {
    ...office,
    name_simple: "Ihre Servicestelle",
    opening_hours,
    sources: [{ ...source, quote: Object.values(opening_hours).join("; ") }],
  };
  expect(OfficeSchema.parse(record)).toEqual(record);
  expect(
    OfficeSchema.parse({ ...office, opening_hours: { notes: opening_hours.notes } }).opening_hours,
  ).toEqual({ notes: opening_hours.notes });
  expect(OfficeSchema.parse(office)).toEqual(office);
});

test("WP-176 AC3 rejects blank office labels and malformed opening hours", () => {
  expect(OfficeSchema.safeParse({ ...office, name_simple: " " }).success).toBe(false);
  for (const opening_hours of [
    "08:00–12:00",
    { monday: " " },
    { notes: " " },
    { mon: "08:00–12:00" },
    { monday: 8 },
  ]) {
    expect(OfficeSchema.safeParse({ ...office, opening_hours }).success).toBe(false);
  }
});
