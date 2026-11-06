import { catalogs, type MessageKey } from "./catalogs.ts";
import type { Locale } from "./config.ts";
import { formatDate, formatNumber } from "./format.ts";
import { formatMessage, type MessageParams } from "./message.ts";

export type I18n = {
  readonly locale: Locale;
  readonly t: (key: MessageKey, params?: MessageParams) => string;
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string;
};

export function createI18n(locale: Locale): I18n {
  return {
    locale,
    t: (key, params) => formatMessage(catalogs[locale][key], locale, params),
    formatNumber: (value, options) => formatNumber(locale, value, options),
    formatDate: (value, options) => formatDate(locale, value, options),
  };
}
