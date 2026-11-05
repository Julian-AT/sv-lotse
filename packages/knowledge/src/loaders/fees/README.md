# SV-Box fee schedules

Import `loadFeeSchedules`, `loadFeeSchedule`, `FeePositionSchema` and
`explainReimbursement` from `@lotse/knowledge/loaders/fees`. No database writes,
network calls, catalog records or tools are involved.

`loadFeeSchedules()` reads `SVBOX_DIR/Leistungskataloge` (default: the repository's
`data/svbox`, resolved relative to this module). Relative `SVBOX_DIR` values are
resolved from the repository root, independently of the working directory.
It requires exactly one matching
Styria PDF and one dental 2026 PDF. An explicit file and kind can instead be passed
to `loadFeeSchedule(file, "styria" | "dental")`.

## Derived layout

The supported snapshots are the 147-page Styria contract-doctor schedule, cover
`Stand: 01.01.2025`, and the 48-page dental special edition effective 1 January
2026. These are layout-specific adapters, not a generic PDF table extractor.
A different page count or cover date is rejected. A replacement with the same
page count/date still requires reviewing the census and samples.

PDF.js 6's legacy Node build extracts the text layer. Baselines within one PDF
point are grouped, then sorted top-to-bottom and left-to-right; superscripts are
kept apart. This is important: concatenating content-stream order attaches
footnote markers to dental codes (`61¹` becomes the incorrect `611`). Original
files remain read-only. Node >=22.13 is required by PDF.js.

- **Styria:** physical pages 25–147 contain the tariff part. Repeated `ABSCHNITT`
  headers identify sections; `Pos.Nr.:` identifies a table. Codes occupy x≈71–103,
  descriptions x≈113–399, euro rates x≈418–510 and laboratory points x≈499.
  A split `x` marker and split code digits are joined in the code column only.
  Page 58 has separate `Honorar / Unkosten / Insgesamt` headers below `Pos.Nr.:`;
  page 126 has two tables and a split `Unkosten / Honorar / Insgesamt` header.
  The nearest preceding table or total-column header determines whether to use
  the published total, without adding that total to its components.
  Radiology's `Unk./€` and `Hon./€` are added in integer cents when both are
  present; a single-column component remains explicitly marked `component`.
  The named flat rates MAMSON, 831 and surcharge 820 in that two-column table
  are standalone tariffs. Point tariffs remain `unit: "points"`: conversion
  depends on quarterly totals and degression (PDF pages 105–106), so a flat
  point-to-euro conversion would be wrong.
- **Variants:** ordination, laser tiers and extension subservices emit separate
  rows with the same published code and distinct descriptions. The included
  ordination base amount is a component, never an additional complete tariff.
  Unnumbered surcharges and fixed travel allowances are excluded rather than
  assigned the previous position's code. Tables with codes but no numeric rate
  (MKP laboratory references) are also excluded.
- **Dental:** physical pages 5–8 and 14–15 contain numbered conservative/surgical
  positions. Description and abbreviation are separate columns. The first
  tariff column groups ÖGK/SVS-LW/Bundesheer, then SVS-GW and KFA Wien;
  BVAEB has a separate table. Each available carrier tariff emits its own row.
  `n. a.` means no tariff, never zero euros. Pages 19–20 and 22 use Roman
  groups and numbered/lettered subservices; hierarchical locators such as
  `III.b` preserve that structure. The unnumbered repair under Roman III on
  page 22 uses locator `III.Reparatur`. Pages 30, 31 and 33 use published
  abbreviations (IF, IB, RI, K1–K3, RH, AB, AG); the unnumbered overall package
  uses its printed label `Behandlungspauschale`. Explanation text is outside
  the tariff table. Patient contributions, private AHR prices and employment
  salary tables are not contract-partner tariffs and are excluded.

`page` is the physical, one-based PDF page, not the printed page number. Dental
printed page numbers are two lower. The Styria tariff part starts at physical
page 25, with printed tariff page 1. Region is Steiermark for the regional doctor
schedule and Österreich for the national dental schedule; carrier remains
explicit, including KFA Wien. Titles join source lines with spaces; quotes retain
line boundaries. They are source descriptions, not medical recommendations.

## Coverage and verification

An independent Poppler `pdftotext -layout` census, checked against the tariff
tables, counts **761 numbered Styria positions** across 68 pages and **114 dental
positions** across 12 pages. The real-PDF tests assert every page's count as well
as 15 independently transcribed exact code/title/euro/page samples. Variants and
carrier columns increase output rows without increasing the census denominator.
`candidateCount`, `parsedCount`, `coverage` and `unparsed` additionally expose
runtime extraction failures. Runtime coverage is relative to recognized code
anchors; the independent census prevents missed anchors from inflating the test
coverage. Original PDFs must be available for these tests; no mocks replace them.

Run from the repository root:

```sh
bun run --filter @lotse/knowledge typecheck
bun run --filter @lotse/knowledge test -- test/loaders/fees
```

`explainReimbursement({ position, paidAmount })` validates cents, rejects points
and incomplete components, and returns the euro tariff and rounded 80% amount,
carrier, region, as-of date, PDF page, and explicit illustrative/non-binding
labels. The paid invoice is context, not the calculation base. The returned
80% amount illustrates the tariff rule; it does not decide personal entitlement,
apply carrier-specific limits or promise a payout.
