import { expect, test } from "vitest";
import { resolveLocale } from "../../src/i18n/locale.ts";

test("FR-L1 profile preference takes precedence over Accept-Language", () => {
  expect(resolveLocale({ profilePreference: "de-simple", acceptLanguage: "en-US" })).toBe(
    "de-simple",
  );
  expect(resolveLocale({ profilePreference: "en", acceptLanguage: "de-AT" })).toBe("en");
});

test("FR-L1 Accept-Language matches regional tags by quality and preserves tie order", () => {
  expect(resolveLocale({ acceptLanguage: "fr, en-GB;q=0.8, de-AT;q=0.9" })).toBe("de");
  expect(resolveLocale({ acceptLanguage: "EN-us, de;q=0.8" })).toBe("en");
  expect(resolveLocale({ acceptLanguage: "en;q=0.8, de;q=0.8" })).toBe("en");
  expect(resolveLocale({ acceptLanguage: "de;q=0, en;q=0.5" })).toBe("en");
  expect(resolveLocale({ acceptLanguage: "de;q=0, *;q=1" })).toBe("en");
});

test("FR-L1 invalid preferences and malformed or unsupported headers fall back safely", () => {
  expect(resolveLocale({ profilePreference: "fr", acceptLanguage: "en" })).toBe("en");
  for (const acceptLanguage of [
    null,
    "",
    "fr-FR",
    "*",
    "en;q=2",
    "en;q=oops",
    "en;q=0",
    "en;q=0.1234",
  ]) {
    expect(resolveLocale({ acceptLanguage })).toBe("de");
  }
  expect(resolveLocale()).toBe("de");
  expect(resolveLocale({ profilePreference: { locale: "en" } })).toBe("de");
});

test("FR-L1 a wildcard does not override the quality of an explicit language preference", () => {
  expect(resolveLocale({ acceptLanguage: "*;q=1, de;q=0.5" })).toBe("en");
  expect(resolveLocale({ acceptLanguage: "*;q=1, de;q=0.5, en;q=0" })).toBe("de");
});
