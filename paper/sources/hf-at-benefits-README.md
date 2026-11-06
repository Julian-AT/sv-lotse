---
license: cc-by-4.0
language:
- de
- en
- tr
- bs
- hr
- sr
- ro
- hu
- pl
- uk
- ar
pretty_name: AT-Benefits
tags:
- synthetic
- social-insurance
- austria
- benefits-navigation
- multilingual
- agents
configs:
- config_name: situations
  data_files:
  - split: heldout_family
    path: situations/heldout_family/*.parquet
  - split: test
    path: situations/test/*.parquet
  - split: train
    path: situations/train/*.parquet
  - split: validation
    path: situations/validation/*.parquet
- config_name: dialogues
  data_files:
  - split: heldout_family
    path: dialogues/heldout_family/*.parquet
  - split: test
    path: dialogues/test/*.parquet
  - split: train
    path: dialogues/train/*.parquet
  - split: val
    path: dialogues/val/*.parquet
- config_name: documents
  data_files:
  - split: heldout_family
    path: documents/heldout_family/*.parquet
  - split: test
    path: documents/test/*.parquet
  - split: train
    path: documents/train/*.parquet
  - split: val
    path: documents/val/*.parquet
- config_name: forms
  data_files:
  - split: heldout_family
    path: forms/heldout_family/*.parquet
  - split: test
    path: forms/test/*.parquet
  - split: train
    path: forms/train/*.parquet
  - split: val
    path: forms/val/*.parquet
- config_name: legal_qa
  data_files:
  - split: test
    path: legal_qa/test/*.parquet
  - split: train
    path: legal_qa/train/*.parquet
  - split: val
    path: legal_qa/val/*.parquet
---

# AT-Benefits

Open synthetic dataset for Austrian social-benefits navigation (SV KI-Lotse research lane):
situations, multi-turn dialogues, documents, forms and legal QA in German (incl. Austrian dialect
and plain language), English, Turkish, Bosnian/Croatian/Serbian, Romanian, Hungarian, Polish,
Ukrainian and Arabic. Labels (benefits, offices, documents, citations) are computed by the
SV KI-Lotse product engine, never by a language model; language models only write surface text,
which is checked for language, faithfulness, leakage and near-duplicates. No real person is
described. Labels are navigation hints, not eligibility decisions.

<!-- family:dialogues -->
## Config `dialogues`

Multi-turn, tool-exact pilot dialogues for Austrian social-benefits navigation. Every dialogue is
an OpenAI-style `messages` list (system, user, assistant with `tool_calls`, tool) with the real
brain tool contracts (`lotse_*`) and outputs from the research tool server, ending in a
`submit_plan` call. Labels (benefits, offices, documents, citations, reward) come from the product
engine and the gym reward, never from a language model.

- **Tier O** (oracle): the gym oracle's own trajectories (template questions and summaries in
  German, English or Turkish, exact tool calls and outputs, reward 1.0); no model text.
- **Tier A** (verbalized oracle): gym oracle trajectories; tool calls, tool outputs and the plan
  are unchanged, the bulk model wrote only the natural-language turns in the target language
  (German incl. Austrian dialect and plain language, English, Turkish, BCS, Romanian, Hungarian,
  Polish, Ukrainian, Arabic), with injected medical questions handed off to a doctor/1450 in a
  sample (`safety_injected`). In `language_variant` rows the user speaks a language other than the
  persona's; tool arguments keep the original situation text.
- **Tier B** (teacher): the strong model played the pilot in the gym against an LLM-simulated user
  with the real tools; kept only with gym reward >= 0.9, zero boundary flags and valid citations.
- **Quality:** every dialogue re-scored with the gym reward (`reward`, `reward_breakdown`); product
  boundary patterns (`boundary_flags` = 0 for all kept rows); language ID on every turn
  (`turn_languages`, `language_match`); MinHash near-duplicates marked (`near_duplicate_of`);
  readability of the pilot's turns; LLM judge rubric on every tier A dialogue (`judge`, only
  passing rows are released).
- **Splits** follow the persona splits; `heldout_family` holds the held-out benefit family.

Rows: 10352 ({'A': 351, 'B': 1, 'O': 10000}); tier A/B languages: {'de': 191, 'ar': 17, 'en': 38, 'pl': 16, 'tr': 23, 'bcs': 12, 'hu': 16, 'uk': 20, 'ro': 19};
mean reward of tier A/B 0.9975. Every tier A row was judged and passed the rubric
(naturalness, faithfulness to tool outputs, language correctness, boundary compliance, plain
language where requested; each >= 4 of 5); pass rate over all judged attempts
0.7374 (476 judged).

_Release v0.2._
<!-- /family:dialogues -->

<!-- family:situations -->
## Config `situations`

1,000,000 synthetic Austrian household personas with a structured card, an opening situation
text and engine-computed gold (benefits, offices, documents, minimum questions, criterion
citations). Generator: the seeded SV KI-Lotse persona generator (seed 202611071), split by index
before sampling; `heldout_family` holds every persona whose bundle contains area D (care), which
never occurs in the other splits; `test` contains two phrasing styles unseen in training.

- `text_source = "template"`: template text in German (incl. Austrian dialect), English or Turkish.
- `text_source = "llm"` (425 rows): the text was rewritten by
  `gpt-6-luna` in one of German (Austrian standard, Austrian dialect by
  state, plain language B1), English, Turkish,
  Bosnian/Croatian/Serbian, Romanian, Hungarian, Polish, Ukrainian or Arabic, matching the
  speaker's register, literacy and noise, from the persona card only. Gold for these rows was
  recomputed by the engine with the new text and language. Every LLM text passed language ID
  (lingua), no benefit/office names (gold + whole life-situation bundle), numbers only from the
  card, no contact data, length 8-220 words and MinHash near-duplicate removal, and was then
  judged by `gpt-6-sol` on faithfulness, no leakage, language, register,
  naturalness and concern (1-5 each); a row is kept only if faithfulness, no leakage and language
  score at least 4. Judge pass rate 0.8799 (95 % Wilson (0.8479, 0.9059),
  n=483); per-variant rates are in the metrics. Acceptance rate
  0.85. Per-row quality fields are in `quality` (JSON).

Rows per split and text source: heldout_family/llm 26, heldout_family/template 18,156, test/llm 35, test/template 36,329, train/llm 333, train/template 908,757, validation/llm 31, validation/template 36,333.

Labels are navigation hints computed by product code, not eligibility decisions. Metrics,
leakage test (text classifier vs card classifier, micro-F1) and a stratified spot-check sample are
in `situations/metrics.json`.

Columns: `id`, `split`, `goal`, `scenario`, `life_situation`, `style`, `noise` (JSON),
`situation_text`, `template_text`, `text_source`, `text_language`, `text_variant`, `household`
(JSON), `gold` (JSON), `gold_benefits`, `quality` (JSON or null), `seed`.

_Release v0.2._
<!-- /family:situations -->

<!-- family:forms -->
## forms

Filled official Austrian forms with field-level gold and field-detection gold.

- **Templates.** 27 registered templates of the SV KI-Lotse form registry: the seven
  SV-Box AcroForm applications (catalog schemas from `packages/knowledge/forms`) and the twenty
  flat SVS forms of the E13 gold set (hand-drawn answer areas, one-based pages, PDF points,
  top-left CropBox origin).
- **Values come from the product.** For each (template, persona) the confirmed facts of a
  synthetic AT-Benefits persona (with statement or document provenance and quotes) are passed to
  the product's prefill policy (`proposeFields`) and renderer (`renderFormPdf`) of
  `packages/brain` through a bun bridge; no value is chosen by a language model. The same
  bridge reproduces the product's E7 gold exactly (218/218 values, 1030/1030 blanks).
- **Field gold** (`fields`, JSON): field id, label, type, owner section, page, boxes, validation,
  required flag, signature flag, fact type and mapping kind (`catalog`, `candidate` for the
  dataset's conservative E13 mapping of the applicant's identity fields, `unmapped`), status
  (`filled`, `missing:<reason>`, `provider_<owner>`, `signature`), value and provenance.
  Doctor, hospital and office sections and signatures are never filled; IBANs only from the
  person's own statement.
- **Detection gold**: boxes, labels, types and owners for the flattened filled PDF
  (`detection_flat`) and for simulated scans (`detection_scan`: rotated, noisy, JPEG-compressed
  image PDFs; boxes transformed accordingly).
- **PDFs**: `pdf_filled` (product output, AcroForm), `pdf_flat`, `pdf_scan` — included only for
  forms whose publisher permits reuse with attribution (SVS: "Die Inhalte der SVS-Website dürfen
  im hier genannten Rahmen bis auf Widerruf weiterverwendet werden, um Quellenangabe wird
  jedoch ersucht"). SV-Box forms (ÖGK, PVA, FSW, AUVA) ship field gold only.
- **Splits** follow the persona splits (train, val, test, heldout_family).

Counts: 15120 instances, 4924 with PDFs, 6084 detection records. All persons are
synthetic; numbers carry valid check digits but belong to nobody. Source attribution per row.

_Release v0.2._
<!-- /family:forms -->

<!-- family:legal_qa -->
## legal_qa

Graded multilingual retrieval questions over Austrian social-insurance law. Each row is a query
whose answer is one exact RIS section (and Absatz where possible) of the corpus
[JulianAT/at-sv-law](https://huggingface.co/datasets/JulianAT/at-sv-law), with BM25 hard negatives.

- **Generation.** For each eligible section (2668 of 2,863; repealed and stub sections
  dropped) a seeded plan assigns 1-4 slots (language, style, difficulty easy/medium/hard); a
  language model writes the question, a German rendering, a short answer, the Absatz numbers and
  a verbatim evidence quote. Languages: German majority (standard, plain language, colloquial
  Austrian), English, Turkish, BCS, Romanian, Hungarian, Polish, Ukrainian, Arabic.
- **Filtering** (after arXiv 2601.14160): rule checks on every question (language ID, at most 6
  consecutive tokens copied from the section, no § / Absatz / law-name citation, evidence quote
  found in the section, valid Absatz numbers, length), MinHash near-duplicate removal per
  language, and an LLM judge on every question (answerable only from the section, correct,
  self-contained, natural, no verbatim copying); only passing questions are kept: judge pass rate 0.9926 (n = 407, 95 % CI (0.9786, 0.9975)).
- **Negatives.** `negative_ids`: top-10 BM25 sections for the German rendering, excluding the
  positive and parallel provisions with the same title in other acts (`parallel_ids`, which may
  also answer the question). `bm25_rank_de` is the positive's BM25 rank (difficulty signal).
- **Splits** by section (no section in two splits): train/val/test = 90/5/5.

Counts: 404 questions (de 138, de-AT-dialect 40, de-easy 37, bcs 31, tr 30, ar 29, en 27, uk 20, ro 19, hu 17, pl 16). Law texts: Datenquelle: Rechtsinformationssystem des Bundes (RIS), Bundeskanzleramt Österreich, licence CC BY 4.0.

_Release v0.2._
<!-- /family:legal_qa -->

<!-- family:documents -->
## Config `documents`

Synthetic German (Austrian) documents a person brings to an advisor: hospital discharge letters
(Entlassungsbriefe), decisions (Bescheide) with appeal instructions, requests for documents,
reminders, private-practice invoices (Wahlarzt/Wahltherapeut Honorarnoten) and prescriptions.
Each document is a real PDF (A4, standard fonts) with exact gold for **documented-statement
extraction** (typed verbatim quotes with page, text offsets and bounding boxes) and plain-words
**letter explanation** targets; about a third also come as degraded 150 DPI scans with OCR.

**449 documents** (heldout_family 35, test 22, train 368, val 24), 499 pages, 4296 gold statements.

| Document type | Count |
| --- | ---: |
| `decision` | 138 |
| `discharge_letter` | 53 |
| `document_request` | 144 |
| `prescription` | 32 |
| `reminder` | 60 |
| `wahlarzt_invoice` | 22 |

### How it is made

* **Spec first.** For each AT-Benefits persona (config `personas`; the split is the persona's
  split, so `heldout_family` documents concern held-out care benefits only) a seeded spec fixes
  every administrative fact: issuing office from the engine gold (`office.resolve`) with its
  catalog address, benefit, dates, case numbers, care level, amounts, deadlines, requested
  documents (catalog `documents` not held by the persona), medicine names, and the documented
  recommendations (benefits from the persona's gold, e.g. rehabilitation, care allowance, aids).
* **Model writes prose only.** `gpt-6-luna` writes the sections as JSON sentences with a role
  (clinical, recommendation, open task, administrative, other). Deterministic validation rejects
  output with dates or amounts not in the spec, medicine names in prose, recommendations that carry
  a medical rationale or are missing, or real public figures; rejected output is retried with the
  error list. Prescriptions are template-only.
* **Renderer owns the gold.** A deterministic reportlab layout (letterheads, address window,
  reference block, tables, footers, page breaks) draws every text item at a known position. Gold
  quotes, page-local `[start, end)` offsets and boxes come from the renderer, and every document is
  verified against the PDF text layer extracted with pdfium before release.
* **Judge filter.** `gpt-6-sol` scores every model-written document on realism, consistency, boundary, german, gold
  (1-5); only documents with all scores >= 4 are released. Pass rate so far:
  417/549 (0.7596; Wilson 95 % [0.7221, 0.7934]).
* **Near-duplicates** of model-written text (MinHash, char 5-grams, Jaccard 0.85) are dropped.

### Gold format (E12-compatible)

`statements` (JSON list): `id`, `type` (`documented_recommendation` | `administrative_fact`),
`fact_type`, `quote` (verbatim page-text slice; line breaks inside a quote are `\n`), `page`
(1-based), `position` `{start, end}` (page-local, Unicode code points = UTF-16 units here), `bbox`
`{x, y, width, height}` normalised to the page with a top-left origin, per-line `boxes`, and
provenance (`source`: spec, catalog or model). Fact types: `institution` 506, `case_number` 449, `document_date` 449, `insurance_number` 440, `open_task` 440, `deadline` 342, `requested_document` 294, `named_medicine` 219, `next_step` 204, `decision` 195, `appeal_info` 138, `carrier` 107, `visit_date` 103, `documented_recommendation` 98, `amount` 96, `admission_date` 53.
`pages` follows the SV KI-Lotse brain's `documentPageSchema` (text = lines joined by newlines;
rows are items within 5 pt of a baseline, left to right, like the E12 pdfjs serialization).
`exclusions` lists clinical sentences (diagnoses, findings, course) for negative overlap checks:
**diagnoses and findings are never gold facts** (PRD FR-D3 and the medical boundary).
`explanation` holds FR-D8 targets computed from the spec, not by a model: what is asked (with
catalog document ids), by when (absolute date or relative appeal period) and what happens next,
plus a plain-language summary; for discharge letters the navigation targets (benefit and
responsible office per documented recommendation).

Other columns: `pdf` (bytes), `scan_pages` (PNG bytes per page, grayscale 150 DPI), `scan_meta`
(rotation, blur, noise, JPEG quality and the rotated gold boxes), `ocr` (Tesseract `deu` text per
page, mean confidence, gold-quote recall), `spec`, `sentences` (model sentences with roles),
`judge`, persona and benefit ids, token usage.

### Limitations

* Synthetic. Hospitals, practices, rehabilitation centres and all persons are invented; carrier
  and authority letters name the real responsible office from the catalog but are not issued by
  it (footer on every page) and use no logos. Insurance numbers have a deliberately wrong check
  digit.
* Medical content is fictional and was not reviewed by clinicians; it is a distractor for
  extraction, not medical information. Appeal periods and courts follow Austrian practice as
  modelled for this dataset and are not legal advice.
* Layouts are generated, so real-world scan artefacts (stamps, handwriting, folds) are missing.
* Reproduce: `uv run python -m datagen.documents.run --tranche 1` then
  `uv run python -m datagen.documents.release` (from `ml/`).

_Release v0.2._
<!-- /family:documents -->
