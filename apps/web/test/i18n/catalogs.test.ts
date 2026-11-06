import { expect, test } from "vitest";
import { shellCopy } from "@/features/shell/copy.ts";
import { catalogs, type MessageKey } from "@/i18n/catalogs.ts";
import { createI18n } from "@/i18n/translator.ts";

test("AC1 every locale has exactly the German catalog's keys and nonempty translations", () => {
  const keys = Object.keys(catalogs.de).sort();
  for (const catalog of Object.values(catalogs)) {
    expect(Object.keys(catalog).sort()).toEqual(keys);
    for (const value of Object.values(catalog)) expect(value.trim()).not.toBe("");
  }
});

test("AC2 every shell copy field is served from its locale's catalog", () => {
  for (const locale of ["de", "en", "de-simple"] as const) {
    for (const [field, value] of Object.entries(shellCopy[locale])) {
      const key = `shell.${field}` as MessageKey;
      expect(value).toBe(catalogs[locale][key]);
      expect(createI18n(locale).t(key)).toBe(value);
    }
  }
  expect(shellCopy.de.title).toBe("Ihr nächster Schritt. In Ihrem Tempo.");
  expect(shellCopy.en.title).toBe("Your next step. At your pace.");
  expect(shellCopy["de-simple"].title).not.toBe(shellCopy.de.title);
});
