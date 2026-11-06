export const SUPPORTED_LOCALES = ["de", "en", "de-simple"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "de";
export const INTL_LOCALES = { de: "de-AT", en: "en-US", "de-simple": "de-AT" } as const;
export const DEFAULT_TIME_ZONE = "Europe/Vienna";
