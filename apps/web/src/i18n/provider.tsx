"use client";

import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react";
import type { Locale } from "./config.ts";
import { I18nError } from "./errors.ts";
import { createI18n, type I18n } from "./translator.ts";

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children?: ReactNode;
}): ReactElement {
  const value = useMemo(() => createI18n(locale), [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value === null) throw new I18nError("MISSING_PROVIDER");
  return value;
}
