# Web copy infrastructure

- Keep copy in `catalogs.ts`, with German as the source of `MessageKey`. English and simple
  German must satisfy `Catalog`; never fall back silently to another language for a missing key.
- Import `createI18n` from `translator.ts` in server code. Client components import
  `I18nProvider` and `useI18n` from `provider.tsx`; keep that client boundary separate.
- Resolve the locale once from the profile preference and request's `Accept-Language` using
  `resolveLocale`. Pass that same locale to server translations and the provider. The provider
  is controlled by its `locale` prop; it does not persist preferences or fetch profiles.
- Supported message syntax: `{name}`, `{value, number}` (optional `integer` or `percent`),
  `{value, date}` (optional `short`, `medium`, `long`, `full`), and cardinal
  `{count, plural, =0 {...} one {...} other {...}}`. Plurals support nesting, `offset:n`, and
  localized `#`. An `other` branch is mandatory. ICU apostrophe quoting escapes syntax;
  ordinary apostrophes remain literal. Unsupported syntax throws `I18nError`.
- Parameters are strings, finite numbers, or valid `Date` values. Dates also accept numeric
  epoch milliseconds. Do not pass strings as dates; parse them at the incoming boundary first.
- Formatting uses `Intl` with the locale mapping and stable default timezone in `config.ts`.
  Simple German shares Austrian formatting. Pass explicit `Intl` options for currency or
  a different date style/timezone rather than adding format logic to components.
- Keep `features/shell/copy.ts` as the compatibility adapter for existing shell consumers.
  Route/provider mounting and profile persistence are owned by their respective work packages.
- Tests live in `test/i18n`; run the web `typecheck`, `test`, and `lint` scripts from the root
  as documented in `apps/web/AGENTS.md`. Formatter fixtures are test-only messages that exercise
  parameter and plural cases absent from the current shell catalog; they are not product copy.
