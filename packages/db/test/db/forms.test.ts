import { expect, test } from "vitest";
import { formFields } from "../../src/db/schema/forms.ts";

test("FR-D5 stores per-field provenance and requires approval for confirmed values", () => {
  const draft = {
    value: "Testperson",
    provenance: { quote: "Name: Testperson" },
    state: "draft",
    approvalId: null,
  };
  expect(formFields.parse({ name: draft })).toEqual({ name: draft });
  expect(formFields.safeParse({ name: { ...draft, state: "confirmed" } }).success).toBe(false);
  expect(formFields.safeParse({ name: { ...draft, state: "unknown" } }).success).toBe(false);
  expect(
    formFields.safeParse({ name: { ...draft, state: "confirmed", approvalId: "" } }).success,
  ).toBe(false);
  const confirmed = { ...draft, state: "confirmed", approvalId: "test-approval" };
  expect(formFields.parse({ name: confirmed })).toEqual({ name: confirmed });
});
