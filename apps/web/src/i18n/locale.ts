import { z } from "zod";
import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "./config.ts";

export const localeSchema = z.enum(SUPPORTED_LOCALES);

type LanguageRange = { tag: string; quality: number };

function parseRange(value: string): LanguageRange | undefined {
  const match =
    /^\s*([a-z]+(?:-[a-z0-9]+)*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(value);
  if (!match?.[1]) return undefined;
  return { tag: match[1].toLowerCase(), quality: Number(match[2] ?? 1) };
}

function matchLocale(tag: string): Locale | undefined {
  if (tag === "de-simple") return "de-simple";
  const base = tag.split("-")[0];
  return base === "de" || base === "en" ? base : undefined;
}

function negotiateLanguage(header: string): Locale {
  const ranges = header.split(",").flatMap((value) => {
    const range = parseRange(value);
    return range ? [range] : [];
  });
  const explicit = new Set(ranges.map((range) => matchLocale(range.tag)));
  const preferred = ranges
    .filter((range) => range.quality > 0)
    .sort((a, b) => b.quality - a.quality);
  for (const range of preferred) {
    // Explicit ranges keep their own quality; a wildcard covers the remaining launch languages.
    const locale =
      range.tag === "*"
        ? (["de", "en"] as const).find((candidate) => !explicit.has(candidate))
        : matchLocale(range.tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export type LocalePreferences = {
  profilePreference?: unknown;
  acceptLanguage?: string | null;
};

export function resolveLocale(preferences: LocalePreferences = {}): Locale {
  const profile = localeSchema.safeParse(preferences.profilePreference);
  if (profile.success) return profile.data;
  const header = z.string().safeParse(preferences.acceptLanguage);
  return header.success ? negotiateLanguage(header.data) : DEFAULT_LOCALE;
}
