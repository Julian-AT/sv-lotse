import { expect, test } from "vitest";
import { DenyListSchema, defaultDenyList, isDeniedControl } from "../../src/safety.ts";

test.each([
  "Absenden",
  "Jetzt bezahlen",
  "Termin verbindlich buchen",
  "Buchung bestätigen",
  "Löschen",
  "Send",
  "Submit application",
  "Pay now",
  "Confirm booking",
  "Book appointment",
  "Delete record",
])("AC4 denies the label %s using validated data", (label) =>
  expect(isDeniedControl({ role: "button", inputType: "button", label }, defaultDenyList)).toBe(
    true,
  ),
);

test("AC4 denies submit types independently of the label", () => {
  expect(
    isDeniedControl({ role: "button", inputType: "submit", label: "Continue" }, defaultDenyList),
  ).toBe(true);
  expect(
    isDeniedControl({ role: "textbox", inputType: "text", label: "Name" }, defaultDenyList),
  ).toBe(false);
});

test("AC4 rejects malformed deny-list data and invalid regular expressions", () => {
  expect(
    DenyListSchema.safeParse({ roles: [], inputTypes: [], labelPatterns: ["["] }).success,
  ).toBe(false);
  expect(
    DenyListSchema.safeParse({ roles: [], inputTypes: [], labelPatterns: [], extra: true }).success,
  ).toBe(false);
});

test.each([
  "one-time-code",
  "section-login ONE-TIME-CODE",
  "current-password",
  "new-password",
  "username webauthn",
])("AC4 denies credential autocomplete tokens: %s", (autocomplete) => {
  expect(
    isDeniedControl(
      { role: "textbox", inputType: "text", label: "Code", autocomplete },
      defaultDenyList,
    ),
  ).toBe(true);
});

test("AC4 validates credential autocomplete token data", () => {
  expect(
    DenyListSchema.safeParse({
      roles: [],
      inputTypes: [],
      labelPatterns: [],
      credentialAutocompleteTokens: [""],
    }).success,
  ).toBe(false);
});
