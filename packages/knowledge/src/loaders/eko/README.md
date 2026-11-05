# EKO export loader (WP-154)

Import `loadEko` from `@lotse/knowledge/loaders/eko`. It asynchronously returns
`{ packs, lookupCoverage }`. The directory argument names the EKO folder itself.
Without it, the loader uses `SVBOX_DIR/Medikamenten Erstattungskodex`; otherwise
it resolves `data/svbox` from the repository location of `import.meta.url`, never
from the working directory. Original data is read-only. No services are needed.
Relative `SVBOX_DIR` values are resolved from that same repository root;
absolute values are used unchanged.

```ts
const eko = await loadEko();
const result = eko.lookupCoverage({ medicineNameExact: nameFromUser });
```

`packs` is the typed administrative pack inventory. The lookup projects only
coverage fields and separate pack entries (pharma number, quantity and unit).
It never returns names of other medicines, prices, ATC records or indication
texts. Input uses a strict Zod object. Matching normalizes Unicode to NFC,
collapses whitespace and lowercases German text; accents, punctuation and dosage
remain significant. No substring, fuzzy, synonym or transliteration matching is
performed. An unknown name means only `listed: false` in this snapshot: no red
box or refusal of reimbursement is inferred from absence.

## Derived fixed-width layout

`medikament.txt` has 6,985 CRLF records of exactly 195 Windows-1252 bytes, with no
header. Decode **Windows-1252**, not UTF-8. All offsets below are zero-based,
end-exclusive. Fields are trimmed individually; records are never trimmed before
slicing. Leading zeros in identifiers and decimal commas in quantities survive.

| Slice   | Meaning / public inventory field                                    |
| ------- | ------------------------------------------------------------------- |
| 0–7     | Pharma number, seven digits                                         |
| 7–9     | Padding                                                             |
| 9–15    | Registration number, six digits                                     |
| 15–18   | Padding                                                             |
| 18–118  | Exact product name                                                  |
| 118–121 | Box marker: `G` green, `Y` yellow                                   |
| 121–125 | Coverage / specialty codes, e.g. `IND`, `RE1`, `RE2`, `F14`, `N P`  |
| 125–129 | Pack quantity, decimal comma allowed                                |
| 129–133 | Unit: `St`, `ml`, `g`, `Hb`, `Pk`                                   |
| 133–140 | KVP price as integer euro cents, **excluding VAT**                  |
| 140–149 | Unit-price digits, preserved as `unitPriceRaw` (scale undocumented) |
| 149–152 | Unexplained classification digit, preserved as `classificationRaw`  |
| 152–158 | Blank in this delivery                                              |
| 158–161 | Divisibility code, e.g. `T2`                                        |
| 161–164 | Price-model marker, e.g. `M`                                        |
| 164–167 | Maximum original-pack count when specified                          |
| 167–195 | Supplementary pack notes, preserved without interpretation          |

Ten named, manually transcribed packs in `test/loaders/eko/eko.test.ts` check the
layout against the original file, including green, IND, RE1, RE2 and umlauts.
The supplied file contains 5,655 green and 1,330 yellow packs (856 RE1, 474 RE2).
There are no red packs. `R` in the box field is supported as red; a specialty
code `R` in the codes field does **not** mean red.

## Text files and private data

`regeltext.txt` and `indtext.txt` contain records `|1234567|;|text|`, in
Windows-1252. The seven-digit key joins to the pack's pharma number. Prefer the
plain legacy rule text and quote its entire field verbatim, including spaces and
punctuation, with one approved exception (owner decision, 2026-11-05): each
embedded ATC code (including ATC group codes) is replaced with
`[ATC-Code entfernt]`. Affected pack entries have `textModified: true`; unchanged or absent rules have
`textModified: false`. Everything else stays verbatim. No medical summary or
interpretation is produced. Missing rules on green packs yield `null`; yellow packs require their rule text.

When a legacy text file is absent, read its `_v2.txt` equivalent as strict UTF-8.
Cheerio decodes HTML entities and converts `<br>` to newline for a readable
verbatim text rendering. Malformed existing legacy files fail rather than falling
back silently. The same ATC redaction applies after HTML rendering in this fallback.

`atccode.txt` contains 6,611 records of 207 Windows-1252 characters: ATC code in
0–7 (right-padded, hierarchical lengths 1, 3, 4, 5 or 7) and description in 7–207.
It is validated internally and discarded. Indication texts are parsed and their
pack references validated internally, then discarded. Neither file can enter a
public pack or lookup result. Missing files, malformed rows, duplicate pack/text
keys, dangling text keys and missing yellow rules fail loading with an error.

**Substance lookup gap:** the delivery has no pack-to-substance or pack-to-ATC
link. A product's registration number is not an ATC foreign key. No substance
index can be derived safely from names or ATC descriptions. Per the owner decision
of 2026-11-05, substance-level answers are out of scope. Do not infer them or
suggest alternative products. The `eko.lookupCoverage` tool wrapper belongs to a
later WP.

## Code legend and approval semantics

Source: `Zeichenerklärungen und Abkürzungen.pdf`, headed **EKO 1/2024**, printed
pages 20–24. This dates the legend, not the medicine export. The medicine file
contains no effective date; loading it does not establish current coverage.

- `G` / `Y`: green / yellow EKO area.
- `RE1`: prior approval by the chef- und kontrollärztlicher Dienst required.
- `RE2`: subsequent control can replace prior approval when the stated use and
  documentation requirements are met. Outside those conditions, approval is
  required. `approvalRequired: false` describes only the conditional default;
  `approvalRule` retains this qualification.
- `IND`: the prescribing doctor must confirm the stated conditions on the
  prescription; approval is required outside those conditions. The indication
  text itself is intentionally withheld.
- `A`, `Au`, `D`, `F`, `K`, `L`, `N`, `P`, `R`, `U`: specialty restrictions;
  `F2J`, `F6J`, `F14`: age restrictions. These trigger `conditionsFlag`, without
  assessing the user's age, diagnosis, specialty or eligibility.
- `L3`, `L4`, …: long-term approval possible for that number of months. The legend
  documents these but this delivery has no such pack codes; none are invented.
- `BP`: bundle pack; `KVP`: price excluding VAT; `OP`: original pack; a quantity
  in parentheses is a maximum original-pack count; absent count means one.
- `T2`, `T3`, `T4`: divisibility; `SG`: controlled-drug dispensing rules.
- The legend also explains administration and unit abbreviations. They are
  preserved as source data; the lookup gives no administration or dosage advice.

`approvalRequestedBy: prescribing-doctor` identifies the administrative actor
when approval is required or may be needed outside conditions. No patient
eligibility decision is made. Public results and inventories are immutable.

## Prescription fees and provenance

`fee-rules.ts` is a sourced administrative snapshot checked on 2026-11-05,
separate from the undated pack export. It returns the 2026 fee of EUR 7.55 per
pack, the 2% annual net-income cap excluding special payments, the EUR 314.01
minimum annual threshold and automatic / application-based exemption guidance.
Sources and short source quotes travel with the result. It does not compute
personal exemptions or a pack-specific payable amount. Refresh this data and
verify effective dates before using it for another year.

Sources: [ÖGK fee and exemption rules](https://www.sozialversicherung.gv.at/cdscontent/?contentid=10007.870471)
and [BGBl. I Nr. 20/2025](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_I_20/BGBLA_2025_I_20.html).
The ÖGK source gives EUR 314.01 for the minimum; this avoids treating the rounded
41-fee illustration on other information pages as the legal monetary threshold.
A future tool wrapper must additionally attach the deployed export's provenance
and freshness; this loader does not invent an export date or claim a live query.

## Verification

From the repository root:

- `bun run --filter @lotse/knowledge typecheck`
- `bun run --filter @lotse/knowledge test -- test/loaders/eko`

Tests read real SV-Box data. Malformation tests modify disposable copies of that
data; they never change the original files or simulate a service.
