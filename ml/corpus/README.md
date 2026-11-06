---
language:
  - de
license: cc-by-4.0
pretty_name: "AT-SV-Law: Austrian social insurance law (RIS, consolidated)"
size_categories:
  - 1K<n<10K
task_categories:
  - text-generation
  - text-retrieval
  - question-answering
tags:
  - legal
  - austria
  - social-insurance
  - german
  - ris
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/train.parquet
---

# AT-SV-Law

Austrian federal social insurance and social benefits law, one record per paragraph (§),
article or annex, in the consolidated version in force on **2026-11-06**. The data comes from
the Rechtsinformationssystem des Bundes (RIS) through its Open Government Data API v2.6
(application `BrKons`, Bundesrecht konsolidiert). It was built for the Lotse-RL research lane
of SV KI-Lotse (continued pretraining, retrieval and citation grounding for an assistant that
explains Austrian social insurance benefits).

## Source, licence and attribution

- Source: RIS OGD API v2.6, `https://data.bka.gv.at/ris/api/v2.6/Bundesrecht`, documents from
  `https://ogd.ris.bka.gv.at/Dokumente/Bundesnormen/...`.
- Publisher: Bundeskanzleramt Österreich, dataset "RIS Daten Version 2.6" on data.gv.at
  (`0fb9ae1a-92cb-4ab8-a589-470c16d4fe21`), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Attribution (required when you reuse this dataset):
  **"Datenquelle: Rechtsinformationssystem des Bundes (RIS), Bundeskanzleramt Österreich,
  https://www.ris.bka.gv.at, CC BY 4.0"**. Every record also carries this in `attribution`.
- Changes made: the official XML was converted to plain text (layout, page headers and the
  metadata block removed; list numbering and table rows kept as text). This dataset is not an
  official publication. Only the versions promulgated in the Bundesgesetzblatt are authentic.

This release contains RIS data only. It contains no text from other sources (in particular no
SozDok/SV-Box content).

## Coverage

Complete crawl: every document listed by the API for the acts below was fetched and parsed.
`§ 0` overview records (the act's long title, no normative text) are dropped.

| Act | Gesetzesnummer | Type | Records |
|---|---|---|---:|
| ASVG – Allgemeines Sozialversicherungsgesetz | 10008147 | BG | 1120 |
| GSVG – Gewerbliches Sozialversicherungsgesetz | 10008422 | BG | 500 |
| BSVG – Bauern-Sozialversicherungsgesetz | 10008431 | BG | 530 |
| B-KUVG – Beamten-Kranken- und Unfallversicherungsgesetz | 10008215 | BG | 372 |
| BPGG – Bundespflegegeldgesetz | 10008859 | BG | 78 |
| FLAG – Familienlastenausgleichsgesetz 1967 | 10008220 | BG | 118 |
| KBGG – Kinderbetreuungsgeldgesetz | 20001474 | BG | 61 |
| KUG – Karenzurlaubszuschußgesetz (repealed, last version) | 10008949 | BG | 22 |
| PFG – Pflegefondsgesetz | 20007381 | BG | 16 |
| SH-GG – Sozialhilfe-Grundsatzgesetz | 20010649 | BG | 10 |
| EinstV – Einstufungsverordnung zum BPGG | 10009142 | V | 9 |
| Kinder-EinstV – Kinder-Einstufungsverordnung zum BPGG | 20009626 | V | 11 |
| AufwAnp-2026 – Aufwertung und Anpassung 2026 (ASVG, GSVG, BSVG, B-KUVG, BPGG) | 20013024 | K | 16 |
| **Total** | | | **2863** |

About 4.7 million characters, roughly 1.1 million tokens (whitespace words × 1.6, a rough
estimate for German BPE tokenizers). `stats.json` in this repository has per-act counts and
SHA-256 hashes of the Parquet file and of the text content.

## Fields

| Field | Description |
|---|---|
| `doc_id` | RIS document number (e.g. `NOR40250349`), unique |
| `act` | Act abbreviation used in this dataset (e.g. `ASVG`) |
| `act_title` | Short title (Kurztitel) from RIS |
| `gesetzesnummer` | RIS Gesetzesnummer of the act |
| `paragraph` | Label as in RIS: `§ 30c`, `Art. 2`, `Anl. 1`, `Art. 25 § 3` |
| `paragraph_key` | Normalised join key: `PARA:30c`, `ART:2`, `ANL:1` |
| `norm_type` | `BG` (Bundesgesetz), `V` (Verordnung), `K` (Kundmachung) |
| `doc_type` | RIS Dokumenttyp (`Paragraph`) |
| `section` | Headings above the paragraph in the same document (Abschnitt, Unterabschnitt), ` / ` separated |
| `title` | Paragraph heading (empty when the heading belongs to a preceding paragraph) |
| `text` | Plain normative text, one paragraph/list item per line |
| `valid_from` | Inkrafttretensdatum of this version (ISO date) |
| `valid_to` | Ausserkrafttretensdatum, if any |
| `promulgation` | Kundmachungsorgan, e.g. `BGBl. Nr. 189/1955 zuletzt geändert durch BGBl. I Nr. 217/2022` |
| `changed` | Last change of the RIS document |
| `version_as_of` | Consolidation date used for the query (`Fassung.FassungVom`) |
| `url` | ELI link to the paragraph on ris.bka.gv.at |
| `xml_url` | Source XML document |
| `source` | Always `RIS` |
| `licence` | Always `CC-BY-4.0` |
| `attribution` | Attribution text required by the licence |
| `text_sha256` | SHA-256 of `text` |

## Versions

- 2026-11-06: first release, consolidated law as of 2026-11-06 (RIS changes up to 2026-10-29).

Rebuild with `uv run python -m corpus.build --acts sv` in the `ml/` directory of the SV KI-Lotse
repository (raw API responses are cached; concurrency ≤ 4 with retries and backoff).

## Limitations

- Snapshot of one date. Future amendments and historical versions are not included (except KUG,
  which is repealed and given in its last consolidated version, with `valid_to` set).
- Labels are not unique per act: transitional and final provisions of amending acts appear as
  `Art. 2`, `Art. 3` etc. several times in the ASVG. Use `doc_id` as the key and `promulgation`
  to tell them apart.
- Plain-text conversion loses formatting; tables are flattened to ` | `-separated rows and
  formulas or images in annexes may be incomplete.
- Not legal advice. The consolidated RIS versions are informative; only the Bundesgesetzblatt
  is legally binding.
- Social insurance practice also depends on statutes (Satzungen), Krankenordnungen and
  Richtlinien of the Dachverband and the insurance carriers, which are not part of this dataset.
