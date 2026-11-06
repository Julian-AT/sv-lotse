import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { I18nError } from "../../src/i18n/errors.ts";
import { I18nProvider, useI18n } from "../../src/i18n/provider.tsx";

function Copy(): string {
  const { t, formatNumber } = useI18n();
  return `${t("shell.settings")}: ${formatNumber(1234.5)}`;
}

test("the React hook reads translated copy and formatting from the nearest provider", () => {
  expect(
    renderToStaticMarkup(createElement(I18nProvider, { locale: "en" }, createElement(Copy))),
  ).toBe("Settings: 1,234.5");
  expect(
    renderToStaticMarkup(createElement(I18nProvider, { locale: "de" }, createElement(Copy))),
  ).toBe("Einstellungen: 1\u00a0234,5");
  const nested = createElement(
    I18nProvider,
    { locale: "en" },
    createElement(I18nProvider, { locale: "de-simple" }, createElement(Copy)),
  );
  expect(renderToStaticMarkup(nested)).toBe("Einstellungen: 1\u00a0234,5");
});

test("the React hook reports a missing provider with a typed error", () => {
  expect(() => renderToStaticMarkup(createElement(Copy))).toThrow(I18nError);
});
