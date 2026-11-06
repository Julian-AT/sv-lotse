# E4: care for a parent, version 1

This set supplies 20 authored synthetic personas for PRD §3 S1, FR-G5 and
the nine scenario criteria in §14. These are evaluation data, never product
routing logic. All parents are mothers; every actor is an adult child helping
their mother. Ages, employment and the actor's location remain separate from
the mother's facts. No case establishes signing authority.

`suite.json` uses the harness `Suite`; each entry in `cases.json` uses `Case`.
`input.persona` validates directly with `PersonaSpecSchema`. The persona's
top-level age describes the helper, while carrier and region describe the
mother's routing facts (explicitly `unknown` or `unconfirmed` when necessary).
The nested actor and subject facts disambiguate ownership. Start with
`input.opening`, also supplied in the persona's known facts. No model is
called by the loader tests.

`expected` is the per-variant judge reference. Resolve its `sources` keys
through `sources.json` and include that evidence with the expected outcome
when preparing a harness `JudgeRun`. Use the real system adapter and the harness
persona simulator for multi-turn runs; this package does not introduce an
adapter, service substitute or canned assistant conversation. Load
`rubric.v1.yaml` with the harness `loadRubric`. It uses the package's
JSON-compatible YAML convention. All nine scores must reach their maximum
for case task success; medical-boundary failure always fails a case.

The suite retains the PRD's informational 90% target and **300-run** release
minimum. Twenty validated variants are not 300 executed conversations, a
task-success measurement, a Wilson interval or a calibrated judge result.
No live services are required by this set.

## Coverage

| Variant suffix | Main distinction | Language | Register |
| --- | --- | --- | --- |
| first-overview | Original broad trigger; routing facts disclosed on request | German | Standard |
| english-overview | Original English trigger; routing facts disclosed on request | English | Standard |
| simple-german | One step at a time | German | Simple |
| simple-english | Graz subject; easy English | English | Simple |
| viennese-dialect | Austrian spoken phrasing | German | Dialect |
| styrian-dialect | Daughter asking in dialect | German | Dialect |
| colloquial-german | Linz subject; informal wording | German | Colloquial |
| colloquial-english | Working helper juggling care | English | Colloquial |
| unknown-pension-payer | Helper cannot yet identify pension payer | German | Standard |
| unknown-subject-residence | Mother's residence after move is unknown | German | Standard |
| unknown-routing-english | Neither routing fact is available | English | Standard |
| conflicting-payer | PVA/SVS uncertainty resolved from pension notice | German | Standard |
| conflicting-residence | Graz/Vienna contradiction resolved explicitly | English | Standard |
| remote-helper | Helper in Vienna, mother in Graz; FSW must not be assumed | German | Standard |
| self-employed-pension | Mother's SVS pension differs from helper's insurer | English | Standard |
| federal-pension | BVAEB-Pensionsservice, not helper's ÖGK | German | Standard |
| documented-orders | Exact rehabilitation and follow-up excerpts | German | Standard |
| no-medical-documents | Retired helper, no medical records | English | Standard |
| voice-captions-german | No pointing, mouse or map required | German | Simple |
| voice-captions-english | Documented orders via voice and captions | English | Simple |

All cases have nightly/weekly tags; nine representative cases also carry `pr`.
The voice/captions variants apply this interaction preference to S1 without
claiming the PRD's S3 accessibility acceptance has been executed.

## Evidence, scope and deviations

- Benefits are candidate options with unknown eligibility explicitly retained:
  Pflegegeld for the mother, counseling, mobile services, helper Pflegekarenz
  and possible 24-hour-care funding. Leave is not promised to a retired helper.
  No care level, income threshold, grant amount or medical necessity is inferred.
- Official public sources were consulted on 2026-11-06. The registry retains
  short supporting passages and URLs; local PRD/directory references are
  checked against repository text. Network checks are not part of offline
  loader acceptance, and no source is marked as human-verified.
- The care benefit, process and form catalogs contain no records in this
  checkout. Expectations therefore use plain descriptions and `catalogRef: null`
  for them. Existing PVA, SVS and FSW office IDs are referenced and checked
  against their actual records. Generic BVAEB health-insurance counters are
  not substituted for a missing dedicated Pensionsservice record. The
  Sozialministeriumservice and other regional counseling offices are described
  plainly when no matching directory record exists.
- The immediate application goal is an initial Pflegegeld request. Its
  checklist includes the informal request or carrier form, signature where a
  returned carrier questionnaire requires one, and existing current medical
  records **if available**. It identifies availability and where to obtain
  each item. Other bundle applications require their own checklists if selected;
  this is not a purported complete submission for all five benefits. Missing
  medical letters do not block an informal initial request.
- **Question baselines are authored, not engine measurements.** There is no
  care process definition to establish an engine minimum. `questions.slots`
  identifies the missing or contradictory residence/pension-payer facts needed
  for routing; the minimum counts these distinct facts, not conversational
  turns. Goal confirmation and action approvals are excluded. An unknown
  answer is accepted and leads to a lookup step, not invented facts or repeated
  questions. Future runs must compare these baselines with the real process
  engine before reporting engine-relative median/p90 excess questions.
- Simple-language readability is assessed by written anchors (short everyday
  sentences, about B1, one instruction at a time). There is no automated or
  calibrated readability score in this data-only suite.
- Document cases contain synthetic excerpts constructed from the real
  challenge discharge letter's E12 annotations (no original patient identity
  is copied). Exact German recommendation and contact text, including line
  breaks and page numbers, is retained even for the English persona. These
  excerpts are test-only fixtures, not newly issued medical orders. The loader
  checks them against the existing source annotations.

## Medical-boundary review

Manual author review of all 20 expected outcomes and every rubric anchor was
performed for PRD §4. Expected actions are administrative only. The two
document variants preserve their supplied recommendation and follow-up
contacts verbatim with page locations; they do not interpret findings,
prescribe rehabilitation, assess risk, recommend therapy/medication or change
dosage. Cases without a documented order explicitly prohibit inventing one.
Schema and provenance tests support this review; they do not replace it or
claim independent clinician review.

## Validation

From the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e4/s1
```
