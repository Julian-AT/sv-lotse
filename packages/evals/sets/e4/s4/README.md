# Child and family scenario suite v1

WP-185 supplies 20 synthetic personas for PRD §3 Child, FR-G5 and §14 E4. This is
an offline, source-backed dataset, not a measured product-success result.

Run the existing package commands from the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e4/s4
```

## Harness use

- Parse `suite.json` with WP-111 `SuiteSchema` and each `cases.json` item with
  `CaseSchema`. `input.persona` parses directly with `PersonaSpecSchema` and can
  be passed to `simulatePersona` with a real `SystemUnderTest` adapter.
- `age` is the speaker's age. Child age and the parent/child/helper relationship
  live in `persona.facts`. For helpers, the top-level insurer describes the
  speaker; it must not silently become the parent's responsible insurer.
- `openingUtterance` is duplicated in persona facts and explicitly requested by
  its style. The simulator remains model-driven; exact opening compliance needs
  checking in a later live run. It must not reveal withheld facts or resolve a
  contradiction before the assistant asks.
- Each case has a complete `expected` object. Resolve every `sourceIds` entry
  against `sources.json` and include the corresponding URI, passage and locator
  in the expected text passed to `judge`. Provenance is judge evidence, never
  additional persona knowledge. Load `rubric.v1.yaml` with `loadRubric`; it uses
  the harness's JSON-compatible YAML subset. Preserve JSON syntax when editing
  or formatting it: do not introduce YAML-only syntax or trailing commas.
- Case success requires the maximum score on all nine rubric criteria and no
  medical-boundary violation. The informational threshold is 90%. The suite
  retains the PRD's **300-run release minimum**: these 20 variants alone must
  report insufficient data. Judge calibration and real multi-turn execution
  remain runtime work, not loader-test assertions.

## Coverage

| Cases | Variation                                                             |
| ----- | --------------------------------------------------------------------- |
| 01–02 | Canonical German/English openings; age and region revealed on request |
| 03–04 | German/English standard language with disclosed intake facts          |
| 05–06 | German/English simple language and one instruction at a time          |
| 07–08 | Austrian dialect, including colloquial administrative phrasing        |
| 09–10 | German/English everyday colloquial phrasing                           |
| 11–12 | Grandparent/aunt asks for a parent; no assumed authority              |
| 13–14 | Missing region or child age, with an answer available on request      |
| 15–16 | Contradictory child age or residence; explicit correction on request  |
| 17–18 | German/English speech and captions, including simple language         |
| 19    | Overview followed by a missing-IBAN Finanzamt reply, with a checklist |
| 20    | English helper, conflicting region and speech/captions combined       |

The personas span young children aged 2–24 months, eight Austrian federal states,
three speaker insurers and adults aged 25–61. Tags select a PR subset that covers
both languages and every requested dimension; all 20 are nightly/weekly items.
All names, situations and statements are authored evaluation fixtures, not user
records. No provider responses or services are simulated here.

## Expectations and provenance

All variants cover examinations, vaccinations, child health, exercise, nutrition,
family counseling, Familienbeihilfe and Kinderbetreuungsgeld, plus regional
navigation. The official [parent-service directory](https://www.gesundheit.gv.at/service/beratungsstellen/gesund-leben/eltern-kind/elternberatung.html)
provides local-service discovery and the REVAN baby/toddler information programme.
The [Vienna directory](https://www.wien.gv.at/zusammenleben/elternberatungsstellen)
is used only for confirmed Vienna residences. A directory lookup does not imply
that a particular appointment, course, fee or individual entitlement was verified.
Programme age limits remain explicit; preschool programmes are not sold as infant
programmes.

The [official Familienbeihilfe procedure](https://www.oesterreich.gv.at/de/themen/familie_und_partnerschaft/familienbeihilfe/Seite.450233)
separates domestic-birth automatic processing, missing-information replies and
application cases. Case 19's letter asks only for bank details. Its checklist is
complete for that reply, not a universal application checklist. The other cases
end at orientation/provider lookup and explicitly require no application documents.
A later application must obtain its own sourced, circumstance-specific checklist.
Bank details are described only; no account number is supplied or fabricated.

`sources.json` records official page excerpts, section locators and retrieval date,
plus exact local PRD passages for behavioral requirements. Portal abbreviation
expansions and link markup are omitted in transcribed excerpts; combined excerpts
are identified in their locators. All referenced official pages were read during
authoring. Tests are offline: they validate provenance closure and local PRD
passages; they do not claim recurring live-link verification.

### Catalog gaps and measurement limits

- At authoring, `packages/knowledge/catalog/` and `forms/` contain no family benefit
  or registered family form records. Those expectations use plain descriptions
  with `catalogRef: null`, as allowed by the brief. The existing
  `ref:offices/finanzamt-oesterreich` is used and resolved by the loader test.
  No office ID is invented for MA 11, a selected provider or an unresolved insurer.
- Question counts are explicitly **authored next-step lower bounds**, not measured
  process-engine minima. Ask only for age/region that the next regional lookup
  needs, or clarification of a contradiction. Count requested fact slots, even in
  a combined question; exclude goal confirmation and choice of next action. At
  runtime, replace the baseline with the engine's minimum and report excess-question
  median/p90. A provisional rubric score cannot establish the engine metric.
- Simple-language rubric scoring requires a recorded B1-oriented readability
  review of the actual transcript. This data-only change does not implement or
  claim a transcript readability measurement.

## Medical-boundary review

Manual authoring review on 2026-11-06 covered **all 20 expected objects**, all
persona facts/openings, every source excerpt and all rubric anchors against PRD
§4. Expected answers contain administrative navigation only. They neither select
vaccines/examinations nor give diets, diagnoses, findings interpretation, personal
risk judgments, therapy, medication or dosage advice. No medical recommendation
is authored or paraphrased. The medical-boundary test is a limited regression
guard in addition to that review, not a substitute for it or human judge calibration.
