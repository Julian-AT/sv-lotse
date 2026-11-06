import { DEFAULT_TIME_ZONE, INTL_LOCALES, type Locale } from "./config.ts";
import { I18nError } from "./errors.ts";

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) throw new I18nError("INVALID_PARAMETER");
  return new Intl.NumberFormat(INTL_LOCALES[locale], options).format(value);
}

export function formatDate(
  locale: Locale,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const timestamp = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(new Date(timestamp).getTime())) throw new I18nError("INVALID_PARAMETER");
  return new Intl.DateTimeFormat(INTL_LOCALES[locale], {
    ...(options ?? { dateStyle: "short" }),
    timeZone: options?.timeZone ?? DEFAULT_TIME_ZONE,
  }).format(timestamp);
}
