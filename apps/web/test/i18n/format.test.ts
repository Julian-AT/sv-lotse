import { expect, test } from "vitest";
import { I18nError } from "@/i18n/errors.ts";
import { formatMessage } from "@/i18n/message.ts";
import { createI18n } from "@/i18n/translator.ts";

const date = new Date("2026-11-06T23:30:00Z");

test("AC3 numbers use German and English separators; simple German keeps Austrian formatting", () => {
  expect(createI18n("de").formatNumber(1234.5)).toBe("1\u00a0234,5");
  expect(createI18n("en").formatNumber(1234.5)).toBe("1,234.5");
  expect(createI18n("de-simple").formatNumber(1234.5)).toBe("1\u00a0234,5");
  expect(createI18n("en").formatNumber(0.25, { style: "percent" })).toBe("25%");
});

test("AC3 dates use locale order and a stable Austrian timezone across server and browser", () => {
  expect(createI18n("de").formatDate(date)).toBe("07.11.26");
  expect(createI18n("en").formatDate(date)).toBe("11/7/26");
  expect(createI18n("de-simple").formatDate(date)).toBe("07.11.26");
  expect(createI18n("en").formatDate(date, { dateStyle: "long", timeZone: "UTC" })).toBe(
    "November 6, 2026",
  );
});

test("ICU arguments interpolate values without interpreting parameter content as syntax", () => {
  expect(
    formatMessage("Hello {name}: {amount, number}", "en", { name: "{other}", amount: 1234.5 }),
  ).toBe("Hello {other}: 1,234.5");
  expect(formatMessage("{value, number, percent}", "de", { value: 0.25 })).toBe(
    new Intl.NumberFormat("de-AT", { style: "percent" }).format(0.25),
  );
  expect(formatMessage("{value, number, integer}", "en", { value: 1.8 })).toBe("2");
  expect(formatMessage("{day, date, long}", "en", { day: date })).toBe("November 7, 2026");
});

test("ICU plurals select exact matches before locale categories and format the count", () => {
  const message = "{count, plural, =0 {No files} one {# file} other {# files}}";
  expect(formatMessage(message, "en", { count: 0 })).toBe("No files");
  expect(formatMessage(message, "en", { count: 1 })).toBe("1 file");
  expect(formatMessage(message, "en", { count: 1234 })).toBe("1,234 files");
  expect(formatMessage(message, "de-simple", { count: 1234 })).toBe("1\u00a0234 files");
});

test("ICU nested plurals and offsets use the nearest count while exact matches use the original count", () => {
  const message =
    "{count, plural, offset:1 =1 {Only you} one {You and # other} other {You and # others: {files, plural, one {# file} other {# files}} (#)}}";
  expect(formatMessage(message, "en", { count: 1 })).toBe("Only you");
  expect(formatMessage(message, "en", { count: 2 })).toBe("You and 1 other");
  expect(formatMessage(message, "en", { count: 4, files: 2 })).toBe(
    "You and 3 others: 2 files (3)",
  );
});

test("ICU exact numeric selectors match by value and unselected branches need no parameters", () => {
  expect(formatMessage("{count, plural, =1.0 {One} other {{name}}}", "en", { count: 1 })).toBe(
    "One",
  );
  expect(formatMessage("{count, plural, one {One} other {#}}", "de", { count: 1.5 })).toBe("1,5");
  expect(formatMessage("{count, plural, other {#}}", "en", { count: 1 })).toBe("1");
});

test("ICU apostrophes escape syntax and preserve ordinary apostrophes", () => {
  expect(formatMessage("It's '{literal}' and ''{name}''", "en", { name: "Ada" })).toBe(
    "It's {literal} and 'Ada'",
  );
  expect(formatMessage("{count, plural, other {'#' '#' #}}", "en", { count: 2 })).toBe("# # 2");
});

test("invalid messages or parameter types throw typed errors without including user content", () => {
  for (const message of [
    "{",
    "}",
    "{name",
    "{x, unknown}",
    "{x, date, invalid}",
    "{x, plural, one {x}}",
    "{x, plural, other {x} other {y}}",
    "{x, plural, invalid {x} other {y}}",
  ]) {
    expect(() => formatMessage(message, "en", { x: 1 })).toThrow(I18nError);
  }
  for (const [message, params] of [
    ["{missing}", {}],
    ["{value, number}", { value: "private-user-content" }],
    ["{value, number}", { value: Number.NaN }],
    ["{value, date}", { value: new Date("invalid") }],
    ["{value, date}", { value: 1e30 }],
    ["{value, plural, other {#}}", { value: "private-user-content" }],
  ] as const) {
    expect(() => formatMessage(message, "en", params)).toThrow(I18nError);
    expect(() => formatMessage(message, "en", params)).not.toThrow(/private-user-content/);
  }
});
