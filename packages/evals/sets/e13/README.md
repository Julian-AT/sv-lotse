# E13 flat official form gold set

20 distinct, unmodified official PDF downloads, 28 pages and 539 manually drawn
field answer areas. Retrieved on 5 November 2026 from the allowlisted SVS origin.
`gold.json` uses the WP-111 `SuiteSchema` and `CaseSchema`; `expected` is an array
compatible with `EvaluationFieldSchema`, enriched with field type and section.

Run from the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e13
```

## Provenance and permitted use

Each document records its exact download URL (including the source version),
retrieval timestamp, SHA-256 of the stored bytes, page dimensions, page field
counts, attribution and checked terms. The source passage identifies the form;
individual annotations identify its page and answer rectangle. PDFs retain all
original pages, including instruction pages. No fillable source was flattened,
no synthetic PDF was substituted, and no field detector generated these boxes.
All 28 pages were inspected with the annotations overlaid during authoring.
These annotations have not had independent human adjudication.

Source: **Sozialversicherungsanstalt der Selbständigen (SVS)**.
The terms reviewed are [SVS Offenlegung, “Urheberrecht – Werkfreiheit”](https://www.svs.at/cdscontent/?contentid=10007.816865&portal=svsportal).
`terms.json` records the permission passage, scope, review timestamp and hash of
the fetched terms page. Every retained PDF was also checked for a separate
copyright/reproduction restriction; none was found. SVS describes its documented
contents as free official works and permits reuse with source attribution, while
excluding additional commercial activities and separately protected third-party
material. This acquisition is for **private, non-commercial challenge testing**.
It does not establish permission for commercial deployment or redistribution.
Keep the per-document attribution and recheck terms before another use.

The sample covers insurance applications, registrations and de-registrations,
support applications and their administrative supporting forms (including a
hospital certificate, a power of attorney and a lease schedule). Two documents
are the distinct Kinderzuschuss and Waisenrente continuation applications, not
two versions or downloads of one form.

### Acquisition exclusions and sampling limits

The brief specifies no publisher quotas. This first set uses SVS-hosted forms
only; it does **not** provide balanced coverage of carriers, ministries, federal
states and FSW. This limits conclusions about generalization across publishers.

- [FSW terms](https://www.fsw.at/p/datenschutz), “Urheberrecht”, require prior
  written consent for copying. FSW forms were excluded.
- [PV terms](https://www.pv.at/web/impressum) limit downloads to personal needs
  and exclude commercial use. No broader test-storage permission was established;
  these forms were excluded.
- [Tirol terms](https://www.tirol.gv.at/impressum/) require a reuse application
  beyond personal information; those forms were excluded.
- [Niederösterreich terms](https://www.noe.gv.at/noe/impressum.html) require
  written permission for external reuse; those forms were excluded.
- [Oberösterreich terms](https://www.land-oberoesterreich.gv.at/nutzungsbedingungen.htm)
  permit reuse with attribution, subject to document-specific restrictions.
  Its origin is absent from `packages/knowledge/allowlist.yaml`. No regional PDF
  was retained or locally allowlisted. Adding regional sources belongs to the
  knowledge-registry owner.
- SVS downloads with AcroForm fields were excluded, including the current
  Kinderbetreuungsgeld and rehabilitation applications. A download being official
  does not by itself make it flat.

## Annotation conventions

- Coordinates are **PDF points in the displayed CropBox, origin top-left**,
  one-based pages, at scale 1, matching the detection contract. `box` uses
  `x`, `y`, `width`, `height`. The sideways lease schedule retains its original
  portrait page coordinates and rotation; the original PDF is unchanged.
- Draw around the answer area rather than the printed label. Exclude borders
  and surrounding prose. For an unboxed signature/date line, use the writing
  space immediately above the baseline. Adjacent fields must not overlap.
- A segmented insurance number, IBAN or date is one logical field, not one field
  per character. Separate printed name components remain separate fields.
  Tables have one field per writable cell, including each repeated blank row.
  The two parts of a lease relationship/date cell are separate fields.
- Each checkbox is a field, including both alternatives of a yes/no question.
  `label_de` combines the printed question/header with its option or column
  context when needed to disambiguate repeated labels. Text labels are normalized
  for whitespace and line wraps; they are not clinical answers.
- `type` is one of the FR-D11 field types. Dates and signatures stay typed even
  when their PDF areas are plain lines. The harness currently scores boxes,
  labels and owners; it does not score `type` or `section`.
- `section` records the nearest printed section heading or descriptive context
  for an unheaded group (`implicit` explicitly marks the default applicant
  context). Dates, signatures and continuation rows inherit their section owner.
  A representative's writable fields map to `applicant`, because the frozen
  owner enum has no representative role.
- The hospital-issued certificate is `hospital` throughout. The visit-assistance
  form has five `doctor` certification cells and fifteen `office` calculation
  cells under its printed SVS-only heading. Non-applicant fields carry
  `ownerEvidence` with a verbatim heading and its source page, including an
  earlier page when ownership continues. The loader verifies these quotes
  against the original PDFs' text layers.
- These are empty form annotations: no personas, patient values, diagnoses,
  interpretation, treatment decisions or medicine advice are generated. Clinical
  labels are opaque layout labels, owned by the hospital/doctor as printed;
  their presence never authorizes the pilot to complete those sections.

## Loading and checks

Read `gold.json` relative to this directory; each `input.document.path` is relative
to this directory too. For `createE13Suite`, map each case to
`{ id, tags, input, gold: expected, source }` and supply the host's actual detector.
Do not send `expected`, attribution, terms or counts to the detector; the actual
PDF bytes are its input. The loader does not invoke a model or claim a detection
recall/precision result.

The offline loader checks all 20 hashes, distinct hashes and case IDs, exact PDF
inventory, source-origin membership, schema validity, page counts/dimensions,
absence of AcroForm/XFA/widgets, all per-page field counts and the total of 539,
positive areas, page containment and pairwise non-overlap. It tests malformed
boxes/counts and verifies explicit non-applicant headings against PDF text. It
also runs `assertNoLeakage` against every existing catalog YAML/JSON record.
All PDF checks use the package's declared `pdfjs-dist` dependency, with no
external executables or new package dependencies needed at test time.

## Inventory

| PDF                             | Official form                                                                                                                 | Pages | Fields |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----: | -----: |
| [svs-000.pdf](pdfs/svs-000.pdf) | Herabsetzung der Beitragsgrundlage in der GSVG-/FSVG-Weiterversicherung                                                       |     2 |     40 |
| [svs-004.pdf](pdfs/svs-004.pdf) | Anmeldung zur Unfallversicherung als Jagdpächter oder Fischereipächter nach dem BSVG                                          |     2 |     39 |
| [svs-008.pdf](pdfs/svs-008.pdf) | Antrag auf Höherversicherung nach dem Bauern-Sozialversicherungsgesetz (BSVG)                                                 |     1 |     10 |
| [svs-009.pdf](pdfs/svs-009.pdf) | Antrag für Bauern auf Verminderung der Beitragsgrundlage und Rückerstattung von Beiträgen                                     |     1 |     20 |
| [svs-010.pdf](pdfs/svs-010.pdf) | Beitragsgrundlagenoption gemäß § 23 Abs. 1a BSVG                                                                              |     1 |     18 |
| [svs-011.pdf](pdfs/svs-011.pdf) | Antrag auf Zurechnung von Beitragsgrundlagenteilen gemäß § 23b BSVG                                                           |     1 |     18 |
| [svs-012.pdf](pdfs/svs-012.pdf) | Verpachtungsverzeichnis für Bauern                                                                                            |     2 |     67 |
| [svs-014.pdf](pdfs/svs-014.pdf) | Antrag auf Option bei Nebentätigkeit gemäß § 23 Abs. 1b BSVG                                                                  |     1 |     19 |
| [svs-016.pdf](pdfs/svs-016.pdf) | Antrag auf Selbstversicherung in der Unfallversicherung nach dem BSVG                                                         |     2 |     34 |
| [svs-017.pdf](pdfs/svs-017.pdf) | Antrag auf Höherversicherung in der Unfallversicherung                                                                        |     1 |      7 |
| [svs-021.pdf](pdfs/svs-021.pdf) | Anmeldung zur Kranken-, Pensions- und Unfallversicherung nach dem BSVG                                                        |     2 |     44 |
| [svs-022.pdf](pdfs/svs-022.pdf) | Abmeldung von der Kranken-, Pensions- und Unfallversicherung nach dem BSVG                                                    |     2 |     17 |
| [svs-027.pdf](pdfs/svs-027.pdf) | Vollmacht (gebührenfrei nach § 12 SVSG)                                                                                       |     1 |     23 |
| [svs-035.pdf](pdfs/svs-035.pdf) | Bestätigung der Krankenanstalt betreffend die Pflege und Betreuung des Kindes durch beide Elternteile (für Familienzeitbonus) |     2 |     18 |
| [svs-049.pdf](pdfs/svs-049.pdf) | Antrag auf eine freiwillige Zuwendung aus dem Unterstützungsfonds für Bauern                                                  |     1 |     42 |
| [svs-053.pdf](pdfs/svs-053.pdf) | Antrag auf Gewährung von Besuchshilfe oder Reisekostenvergütung                                                               |     2 |     58 |
| [svs-058.pdf](pdfs/svs-058.pdf) | Antrag auf Befreiung von der Kostenbeteiligung für Bauern                                                                     |     1 |     11 |
| [svs-067.pdf](pdfs/svs-067.pdf) | Antrag auf Zuschuss aus dem SVS Unterstützungsfonds – Unwetterschadensfälle                                                   |     1 |     10 |
| [svs-125.pdf](pdfs/svs-125.pdf) | Antrag auf Weitergewährung des Kinderzuschusses über das 18. Lebensjahr                                                       |     1 |     22 |
| [svs-126.pdf](pdfs/svs-126.pdf) | Antrag auf Weitergewährung der Waisenrente über das 18. Lebensjahr                                                            |     1 |     22 |
