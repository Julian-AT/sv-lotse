---
license: cc-by-4.0
language:
  - de
  - en
  - tr
pretty_name: AT-Benefits Personas
size_categories:
  - 10K<n<100K
task_categories:
  - text-classification
  - question-answering
tags:
  - synthetic
  - social-insurance
  - austria
  - benefits-navigation
  - agents
configs:
  - config_name: default
    data_files:
      - split: train
        path: data/train.parquet
      - split: validation
        path: data/val.parquet
      - split: test
        path: data/test.parquet
      - split: heldout_family
        path: data/heldout_family.parquet
---

# AT-Benefits Personas

Synthetic household personas for training and evaluating agents that guide people through
Austrian social-insurance and social benefits (the AT-Benefits gym of the SV KI-Lotse research
lane). Each persona has a structured card, a short situation text in German (including Austrian
colloquial and dialect variants), English or Turkish, and gold labels: the benefits, responsible
offices, required documents, minimum number of questions and criterion citations.

**Synthetic and rule-labelled.** No real person is described. Cards and texts are sampled by a
seeded template generator; no language model wrote any text. Gold labels are computed by the
SV KI-Lotse product engine (catalog bundle assembly, criterion evaluation, office rules, documents
checklist, process engine) through its research tool server (`POST /gold`). A label is wrong only
if a catalog rule is wrong. The labels are navigation hints, not eligibility decisions: the engine
treats unknown facts as "unknown", never as "not met", and the competent authority decides.

## Splits

| Split | Personas | Content |
| --- | ---: | --- |
| `train` | 50,000 | All scenarios except the held-out family |
| `validation` (`val`) | 2,000 | Same distribution as train |
| `test` | 2,000 | Same scenarios; about half use two phrasing styles never seen in train/val (`telegraphic`, `formal_letter`) |
| `heldout_family` | 1,000 | Only scenarios whose benefit bundle contains area **D (care)**: care and disability |

The split is a function of the persona index and is fixed before anything is sampled or rendered
(the Medlyn pattern). Area D benefits (Pflegegeld, 24-hour care support, care leave, care part-time,
care leave allowance, Vienna care counselling and mobile services) never appear in the gold of
train, validation or test, and the `care` and `disability` life situations occur only in
`heldout_family`. Area D was chosen over area E because E benefits (family allowance, childcare
allowance, prescription-fee exemption, social assistance) belong to five life-situation bundles,
including the family bundle, so holding E out would have removed most family and low-income
scenarios from training; D is confined to two bundles.

## Fields

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | `p-NNNNNN`, the generator index |
| `split` | string | `train`, `val`, `test` or `heldout_family` |
| `household` | JSON string (list) | Members with `role` (`subject` or `helper`), `age`, `sex`, `residence {state, district}`, `insurance {carrier, status, pension_carrier}`, `employment`, `income_band`, `care {pflegegeld_level, needs}`, `children [{age}]`, `documents_held`, `language`, `register`, `literacy`. Categorical values come from the engine's vocabulary (`GET /catalog/summary`): lower-case carrier ids (`null` when uninsured), office-context statuses, catalog document ids in `documents_held`, and districts only where office rules read them (Vienna as numbers 1–23, Styria by name; otherwise `null`) |
| `situation_text` | string | Opening statement of the speaker (the helper if present, else the subject) |
| `goal` | string | Goal benefit id from the catalog (`GET /catalog/summary`) |
| `noise` | JSON string | `partial_knowledge`, `contradiction`, `dialect` in [0, 1] as applied to the text |
| `gold` | JSON string | Engine output: `benefits`, `offices`, `offices_unresolved`, `documents` (required per benefit), `excluded`, `criteria_status`, `warnings`, `min_questions`, `question_slots`, `citations` (`benefitId`, `criterionId`, `status`, `source`, `legalBasis`), `goal`, `process`, `life_situation` |
| `gold_benefits` | list of strings | Copy of `gold.benefits` for convenience |
| `scenario` | string | Generator scenario (30 archetypes, e.g. `care_for_parent`, `sick_pay`) |
| `life_situation` | string | Bundle the gold was computed for |
| `style` | string | Phrasing style of the text |
| `text_language` | string | `de`, `en` or `tr` |

To keep the files small, the stored gold omits fields the engine returns that are derivable:
`facts` (from the card), `documents_status` (from `documents_held` and the catalog) and the
citation quotes (from the catalog by benefit and criterion id).

## Generation and validation

* Languages of the text: about 70 % German (`de-AT`; registers formal, neutral, colloquial,
  dialect with word-level Austro-Bavarian substitutions), 15 % English, 15 % Turkish.
* Noise: facts (age, residence, insurance, income, care needs, children, documents) are omitted or
  replaced by "not sure" with probability `partial_knowledge`, contradicted and corrected with
  probability `contradiction`, and dialectised with probability `dialect`.
* The text never contains the name of any benefit in the persona's bundle (checked against every
  catalog name in the life situation, a superset of the gold).
* Validation (`ml/results/personas-<gitsha>.json`): schema, disjoint ids, held-out area absent from
  non-held-out gold, held-out styles only in test, no gold names in text, distributions per split
  (language, scenario area, life situation, carrier, status, state, style, register), SHA-256 of
  every file. Every persona has non-empty gold (0 % empty).
* Leakage test: one-vs-rest logistic regression trained on 20,000 train personas, scored on test
  (micro-F1 over 44 gold benefits). Situation text (TF-IDF) 0.976, persona card (one-hot) 1.000,
  base rate 0.340. The test fails if text beats card by more than 0.02; it passes.

Reproduce (needs the research tool server on `http://127.0.0.1:4317`):

```sh
cd ml
uv run python -m personas.generate --n 55000 --out data/personas
uv run python -m personas.validate --data data/personas --leakage
```

## Limitations

* Synthetic: template texts are shorter, cleaner and less varied than real requests, even with
  noise and dialect; models trained on them must be evaluated on real text separately.
* Gold is only as correct as the catalog as of 2026-11-06 (51 benefits, 316 offices) and the
  facts the card provides. Criteria that need facts the card lacks stay "unknown" and do not
  exclude a benefit, so gold lists tend to be inclusive.
* The card fields `employment`, `income_band`, care `needs`, helper members, `language`,
  `register` and `literacy` do not change gold; the gold mapping does not read income.
* Turkish and English texts are hand-written templates without dialect variation; regional
  benefits exist only for Vienna and Styria.
* Not legal or medical advice. Do not use the labels to decide anyone's entitlement.

## Licence

CC BY 4.0. Catalog facts derive from public Austrian sources cited per criterion
(`gold.citations[].source`).
