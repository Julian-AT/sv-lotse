# SV-Box inventory

Inventory of the challenge data ("KI Challenge Daten Use Case 1"). The original files are stored
unmodified under `data/svbox/` (byte-exact, see `.gitattributes`). The data is licensed for the KI
Challenge 2026 only, so the repository stays private. Loaders read it from `SVBOX_DIR`
(default `data/svbox`).

| Folder | Files | Size | Formats |
| --- | --- | --- | --- |
| Anträge und Formulare | 7 | 5.4 MB | PDF (all fillable AcroForms) |
| Befunde | 5 | 0.4 MB | PDF (text layer) |
| Leistungskataloge | 3 | 5.9 MB | PDF (text layer) |
| Medikamenten Erstattungskodex | 7 | 5.5 MB | 6 TXT, 1 PDF |
| Rechtstexte | 14,244 | 61.6 MB | XML (SozDok) |

## Anträge und Formulare

All seven are fillable PDF forms (AcroForm). There is no XFA and none is scanned. Every form has a text
layer, so labels can be located for field mapping. Many field names are abbreviations (`Fam`, `körperl`,
`regelm`, `ausl`), so fact mapping uses label positions and is reviewed by a person.

| File | Publisher | Pages | Fields | Use |
| --- | --- | --- | --- | --- |
| `Antrag Kur und Reha.pdf` (application for a rehabilitation, Kur or recovery stay) | Health insurer | 2 | 96 | Scenario 3: rehabilitation application, filled live |
| `Reha_n_Unfall_052026.pdf` (Anschlussheilverfahren or rehabilitation after an accident) | Health or pension insurer; "vom antragstellenden Krankenhaus auszufüllen" | 2 | 59 | Hospital form: explained and handed to the hospital, never filled by the pilot |
| `PAL080_0125_Mpfl_052026.pdf` (Pflegegeld application PAL 080) | PVA | 8 | 102 | S1 and scenario 3 task list |
| `Antrag-auf-Zuschuss-zu-Fahrtkosten_Wien.pdf` (travel-cost subsidy) | ÖGK Wien | 2 | 13 (incl. IBAN) | Scenario 3 task list; IBAN only from the user's own statement |
| `fsw-antrag-auf-foerderung-von-leistungen.pdf` (funding application, V8 03/2026) | FSW | 13 | 122 (3 signature) | S1 (Vienna): home care and other services |
| `FSW-Antrag-Beilage-Einrichtungswunsch.pdf` (facility wish for residential and care homes) | FSW | 2 | 13 | S1 |
| `Bedarfsmeldung-Senior_innen-Wohngemeinschaft_Basispaket.pdf` (senior shared-flat notice) | FSW | 2 | 21 | S1 |

## Befunde

These are ELGA-style printouts with a text layer, not CDA XML. They are fictional ("frei erfunden und
ausschließlich für die KI-Challenge 2026 bestimmt").

| File | Content | Use |
| --- | --- | --- |
| `Entlassungsbefund.pdf` | 7-page discharge letter, Internal Medicine and Oncology, fictional patient Anna Berger | Scenario 3 demo input; E12 |
| `Röntgen Befund.pdf`, `Röntgen Befund2.pdf` | Imaging reports, 3 pages each | E5 boundary inputs (findings are never interpreted); E12 |
| `Befund bildgebende Diagnostik.pdf` | Ultrasound report, 1 page | E5; E12 |
| `Impfpass.pdf` | e-vaccination pass, 2 pages | Vaccination facts for FR-G6; E12 |

Sections of the discharge letter:

1. Patient data.
2. Admission diagnoses and history. These are never extracted as facts.
3. Course of stay.
4. Findings at discharge.
5. Discharge medication: Amlodipin, Ondansetron, Macrogol, Pantoprazol, and further oncological
   medicines. These are named substances, not products, which drives the substance-level EKO answer
   (FR-M1).
6. Recommendations for further medical care.
7. **Recommendation for medical rehabilitation.** This is the documented recommendation that scenario 3
   quotes.
8. **Social-insurance hints:** Pflegegeld, prescription-fee exemption, travel-cost support, transport
   to treatment.
9. **Open tasks after discharge**, a table of tasks with who is responsible:
   - book a GP check;
   - coordinate radiotherapy;
   - align the medication plan;
   - organise mobile home care;
   - prepare the rehabilitation application;
   - check the Pflegegeld claim;
   - sort out travel to treatments;
   - check the prescription-fee exemption.

   These map one-to-one to journey-map steps.
10. Summary.

## Medikamenten Erstattungskodex

| File | Format | Content |
| --- | --- | --- |
| `medikament.txt` | Fixed-width, Windows-1252, CRLF, about 6,990 lines | One pack per line: pharma number, a second id, name, box (`G` and others), pack size, price and code columns (for example `T2`, `IND`, `L3`). Column offsets are taken from the legend by the loader and covered by tests |
| `regeltext.txt` / `regeltext_v2.txt` | `\|pharma number\|;\|text\|`, Windows-1252 / UTF-8 with HTML entities and `<br />` | Coverage rules (for example the conditions of the yellow box) |
| `indtext.txt` / `indtext_v2.txt` | Same format | Indication texts. Never shown to the model |
| `atccode.txt` | Fixed-width ATC code plus name | Classification. Never shown to the model |
| `Zeichenerklärungen und Abkürzungen.pdf` | PDF | Legend: boxes, specialist-group codes (A, Au, D, F, K, L, N, P, R, U), IND, age limits (F2J, F6J, F14), long-term approval (L3, L4 …), KVP |

## Leistungskataloge

| File | Pages | Content | Use |
| --- | --- | --- | --- |
| `Serviceratgeber-2026…pdf`: ÖGK "Leistungen und Services 2026" | 59 | Insurance, prevention, Vorsorgeuntersuchung, screening, vaccinations, aids and appliances, home care, rehabilitation, Kur, sick pay, transport costs, maternity, KBG, Eltern-Kind-Pass, dental care, 1450 | Seed source for ÖGK catalog records with quotes |
| `ÖGK Honorarordnung…pdf`: fee schedule for contract doctors, Styria | 147 | Positions with € amounts (for example position 250, fracture care, € 23.01), as of 1 January 2025 | FR-M2 illustrative reimbursement amounts |
| `Zahnärzte Honorarordnung_2026…pdf` | 48 | Dental fee schedules 2026 (ÖGK, SVS, BVAEB, KFA Wien) with amounts | FR-M2 for dental services |

## Rechtstexte (SozDok)

14,244 XML files, one per paragraph and version. The file name encodes the identity:
`<law>=PARA=<number>=<BGBl number>=<publication date>=<in-force date>.xml`, for example
`ASVG=PARA=154a=106=2024-07-19=2020-01-01.xml`.

The largest groups:

| Law | Files |
| --- | --- |
| ASVG | 795 and more |
| GSVG | 426 |
| BSVG | 419 |
| e-MVB | 345 |
| DO.A, DO.B, DO.C | 315, 268, 255 |
| B-KUVG | 293 |
| Krankenordnung BVAEB | 120 |
| NVG | 115 |
| ASGG | 104 |
| EU and bilateral social security agreements | several hundred |

The XML follows `Sozdok.xsd`:

- `metadaten` carries the law abbreviation and title, paragraph number, in-force date (`ikra`),
  publication date, area tags (`berkz`, for example `KVL; UVL; PVL`) and the amending act.
- `nutzdaten` holds the heading and paragraphs (`absatz`), with cross-references (`rvolink`).
- Several versions of the same paragraph exist. The SozDok loader selects the version in force on
  the query date and keeps the others for history.

## Where the data is used

| Data | Used by |
| --- | --- |
| Forms | Form templates and mappings in `packages/knowledge/forms`, E7 prefill evaluation, live form filling |
| Befunde | E12 extraction annotations, E5 inputs, scenario 3 demo |
| EKO | EKO loader (`packages/knowledge/src/loaders/eko`) |
| Fee schedules | Fee loader (`packages/knowledge/src/loaders/fees`) |
| Service guide | Benefit catalog sources in `packages/knowledge/catalog` |
| SozDok | SozDok loader (`packages/knowledge/src/loaders/sozdok`) |
