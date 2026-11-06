import type { MessageKey } from "../../i18n/catalogs.ts";
import type { Locale } from "../../i18n/config.ts";
import { createI18n } from "../../i18n/translator.ts";

type ShellCopy = {
  [Key in MessageKey as Key extends `shell.${infer Field}` ? Field : never]: string;
};

function copyFor(locale: Locale): ShellCopy {
  const { t } = createI18n(locale);
  return {
    skip: t("shell.skip"),
    navigation: t("shell.navigation"),
    settings: t("shell.settings"),
    reset: t("shell.reset"),
    resetting: t("shell.resetting"),
    resetDone: t("shell.resetDone"),
    resetError: t("shell.resetError"),
    resetHelp: t("shell.resetHelp"),
    eyebrow: t("shell.eyebrow"),
    title: t("shell.title"),
    introduction: t("shell.introduction"),
    privacy: t("shell.privacy"),
    boundary: t("shell.boundary"),
    footer: t("shell.footer"),
  };
}

export const shellCopy = {
  de: copyFor("de"),
  en: copyFor("en"),
  "de-simple": copyFor("de-simple"),
};
export type Language = Locale;
