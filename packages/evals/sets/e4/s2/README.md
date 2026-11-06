# Health promotion scenario data, version 1

This set supplies 20 fictional personas for the PRD §3 health-promotion scenario,
FR-G5 and E4. This is source-backed evaluation data, not a human-calibrated judge
or a measured product success rate. No provider calls are needed to load the set.

Run from the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e4/s2
```

`suite.json` uses the harness `SuiteSchema`; `cases.json` uses `CaseSchema` and each
`input.persona` uses `PersonaSpecSchema`. `rubric.v1.yaml` is JSON-compatible YAML
1.2, loaded with the harness `loadRubric`, without another dependency. Preserve its
JSON syntax: do not run a YAML formatter that introduces trailing commas.

## Loading and running

The loader test specifies and validates the data contract. Each expected-outcome
array contains IDs into `outcomes.json`, **not catalog IDs**. Expand these IDs into
their description, optional `catalog` reference and source passages before passing
`JSON.stringify(expandedExpected)` to the harness judge. Expand `questions.sources`
and `presentation.sources` from `sources.json` too. Retain the numeric question
minimum and requested presentation in the judge input. `catalog.id` is an actual
knowledge record ID; its `path` is checked against the current repository. Never
treat an outcome ID as a benefit or office identifier.

Start the persona with `input.openingUtterance` exactly. The same text is in
`persona.facts.openingUtterance` and the style instructs the existing simulator to
use it. The persona knows the facts and follow-up answers but initially discloses
only the opening. Required missing/conflicting slots are answered when asked.
The actor metadata belongs to the speaker; helper cases have a separate
`facts.subject` with the beneficiary's age, carrier and location. Do not inject
hidden persona facts into the system under test.

Each run first confirms the prevention goal, explains the applicable bundle and
then prepares the selected administrative step. It need not book appointments or
complete every offer in one conversation. Every case covers VU, access to
vaccination records, target-group screening, Bewegt im Park, nutrition counseling
and regional offers; detailed expectations vary with the selected step and known
target-group facts. Missing criteria remain unknown. All appointment preferences
needed for the selected enquiry are stated in the opening.

The question minimum is an **editorial selected-step baseline**, not a measured
process-engine result: count missing required fact slots, including each fact in
a bundled question. Goal confirmation and action approval are separate. Reconcile
the baseline with the actual engine trace when integrating a real E4 adapter.
Asking about an irrelevant unknown insurer before a free park-course search is
excess questioning. Clinical history is not needed for a directory enquiry.

The rubric defines task success as all criteria reaching their maximum score,
including the binary medical boundary. Report excess questions separately, with
median and p90. The full release gate remains **300 runs**, 90% task success with
a 95% Wilson interval, informational until judge calibration. Twenty authored
variants and the `pr` subset cannot establish release attainment. Actual multi-turn
brain execution, engine reconciliation, readability measurement, caption rendering
and human judge calibration belong to later integration; the offline loader does
not claim those results. Serialize relevant speech/caption events into the judge
transcript when evaluating the voice path.

## Variant coverage

| Case suffix | Main dimension                | Selected step / distinction                          |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| 01          | German                        | Adult VU provider search in Innsbruck                |
| 02          | English                       | BVAEB member, VU in Vienna                           |
| 03          | Simple German                 | Age 60, VU and colorectal program overview           |
| 04          | Simple English                | SVS member, Land Tirol nutrition enquiry             |
| 05          | Austrian dialect              | Free park course without registration                |
| 06          | Colloquial German             | Prepare a VU call in Linz                            |
| 07          | Helper in German              | Son in Vienna organizes father's VU in Tirol         |
| 08          | Helper in English             | Daughter organizes mother's breast-program enquiry   |
| 09          | Missing age                   | Ask age once before confirming adult VU access       |
| 10          | Missing location              | Ask current location once before course search       |
| 11          | Missing carrier               | Do not block the park search on irrelevant insurance |
| 12          | Conflicting age               | Resolve 44/54 before breast-program routing          |
| 13          | Conflicting location          | Resolve Graz/Innsbruck before regional counseling    |
| 14          | Voice/captions, simple German | Age 74, no essential map or pointing                 |
| 15          | Voice/captions in English     | Age 41, voluntary program activation first           |
| 16          | Uninsured adult               | ÖGK Tirol entitlement-voucher enquiry                |
| 17          | English, age 50               | Breast access with e-card; no invitation/referral    |
| 18          | German, age 42                | Opt-in, no automatic program activation              |
| 19          | German, age 45                | Published colorectal access; clinician chooses tests |
| 20          | English, family history       | Age 38; individual questions go to a doctor          |

## Sources and data gaps

`sources.json` records official page URLs, source sections, excerpts and the review
date, 2026-11-06. Local PRD references use `file:///repo/` as a portable repository
root; the loader verifies their passages against the real file. External passages
were checked against the official pages using Firecrawl (HTTP 200); offline tests
validate provenance structure without making changing network responses a unit-test
dependency. Excerpts may join multiple statements from the named section; they are
provenance, not assistant answers. Provider details and actual availability must be
retrieved again when running the scenario, with their own retrieval dates.

The dedicated social-insurance breast-program page publishes automatic access for
women aged 45–74 and opt-in at 40–44 or 75+. The general VU overview still contains
older, conflicting breast age bands; use the dedicated program page for these
expectations. The colorectal source publishes access from age 45. These are program
criteria, never recommendations about a person's medical need or risk.

At authoring time there are no prevention benefit or form records in the catalog.
Use plain sourced descriptions rather than inventing IDs. The existing
`oegk-tirol` office record is used only for the uninsured entitlement route. No
local participating practice or counseling-point catalog ID is available; resolve
it from the official directories at execution time. The selected steps do not
require an application form. No voucher-issuance or provider-intake checklist is
claimed complete where the cited overview does not publish one. Optional VU
records are distinguished from required entitlement proof and are never interpreted.
These are documented data limitations; no frozen contract changes are needed.

## Manual medical-boundary review

Reviewed all 20 persona goals/openings, every resolved expected outcome and all
nine rubric anchors against PRD §4. Expected outputs contain administrative access
rules, document provenance, directory searches and appointment preparation only.
They do not diagnose, interpret findings, give personal risk/urgency/reassurance,
select vaccines, recommend therapies, medicines, doses, diets, individual screening
tests or earlier starts. Family history leads to a clinician enquiry without an
individual assessment. Vaccination status leads to record access and clinician
questions. Source passages describe programs; they are not personalized medical
recommendations. The loader checks required boundary controls; this manual review
does not claim automated detection of arbitrary medical advice or human calibration.
