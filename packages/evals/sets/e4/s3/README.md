# E4 after-hospital suite, version 1

This is an authored, source-backed evaluation dataset using the WP-111 `Suite`,
`Case`, persona and rubric schemas. It contains 20 gold administrative outcomes
with synthetic persona variations around the **fictional** SV-Box patient.
There is no product adapter, model run or measured success rate in this WP.
`minimumSetSize: 20` describes this scenario slice, not the PRD's 300 release runs
across the complete E4 set. Its 90% task-success gate remains informational until
judge calibration (200 double-rated runs, kappa at least 0.8).

## Files and consumption

- `suite.json`: WP-111 suite metadata. Combine this slice with other E4 slices
  before registering E4; the harness permits one registration per suite ID.
- `cases.json`: 20 independently consumable WP-111 cases. Each `input.persona`
  validates with `PersonaSpecSchema`; `facts.openingUtterance` instructs the
  simulator to open with `input.utterance`. The adapter must enforce the opening
  and document visibility; the simulator prompt alone is not a guarantee.
- `sources.json`: stable expectation-source keys with URI, repository/SV-Box path,
  passage and page for PDFs. Every goal, outcome, question policy, next action,
  adaptation, end state and boundary carries nonempty source references.
- `rubric.v1.yaml`: JSON-compatible YAML 1.2 for `loadRubric`, without a new parser
  dependency. Preserve JSON compatibility when editing; do not introduce trailing
  commas or YAML-only syntax. The local `biome.json` preserves this file's format,
  matching the package's existing rubric convention; other checks remain enabled.

Give the judge the complete `expected` object plus its resolved source records,
transcript, artefact/approval evidence and actual process-engine question baseline.
`expected.outcomes[].references` are catalog references only when the corresponding
record exists; an empty array means use the sourced description, not an invented ID.
Do not expose expected outcomes, the source registry or unshared document pages to
the system under test. Provide only the persona's approved context and real assets.
In particular the partial-letter case initially exposes page 1 only; the full PDF
is the source fixture, not permission to expose all seven pages.

Task success requires every rubric criterion at its maximum and the case's stated
prepared/pending end state. The LLM judge alone cannot verify tool execution;
include actual action/approval evidence. Report Wilson 95% intervals, not a claim
that these loader tests establish product success. Never turn missing engine,
source or model evidence into a passing score. The absent-subject case succeeds
by leaving personalized work pending until subject approval; it must not disclose
or import the mother's document while waiting.

## Coverage

| Cases | Variation                                                                         |
| ----- | --------------------------------------------------------------------------------- |
| 01–02 | Standard German and English openings                                              |
| 03–04 | Simple German and English                                                         |
| 05–06 | Austrian dialect; one spoken with captions                                        |
| 07–08 | Colloquial German and English                                                     |
| 09–10 | Daughter with approved join; English-speaking son awaiting subject approval       |
| 11–13 | Missing pension carrier, current residence, or document pages                     |
| 14–16 | Conflicting carrier/address, relocated BVAEB contact, conflicting pension notices |
| 17–18 | Entire workflow by voice and captions; German and simple English                  |
| 19    | Spouse, missing attachments and paper preference                                  |
| 20    | Substance-only medicine names, coverage uncertainty and exemption facts missing   |

Every case includes all twelve administrative outcome areas: import, quote
extraction, rehabilitation, office, applicant-only live filling, checklist,
facility search, appointment preparation, fee exemption, EKO, further support,
and hospital handoff. Case-specific expectations determine which steps are
prepared and which remain pending. Nine diverse cases have `pr`; all twenty
have `nightly` and `weekly`.

The actor's age in helper personas is separate from the fictional patient's age.
Additional pension affiliations and administrative corrections are explicitly
synthetic persona statements; they are not presented as extracted letter facts.
The letter's clinical content is never modified. Known facts must not be asked
again. Unknowns remain unknown unless supplied by the persona or a verified tool.

## Sources and catalog gaps

The source focus is `Befunde/Entlassungsbefund.pdf` (seven pages, pinned SHA-256 in
every case). The tests read actual files from `SVBOX_DIR` or, by default,
`data/svbox` relative to the repository root derived from `import.meta.url`.
A relative override also resolves from the root, independent of working directory.
Missing originals fail validation. PDF passage checks normalize whitespace only;
medical quotations displayed at runtime must retain original wording and qualifiers
and carry page and bounding box, as required by FR-D3/FR-D4.

The recommendation on page 5 is evidence for navigating the rehabilitation
application, not evidence of entitlement, current readiness or a start date.
The open-task bundle includes Pflegegeld/PAL 080, mobile support/FSW funding,
travel support and prescription-fee exemption as conditional checks. The supplied
ÖGK travel form targets people with prescription-fee exemption; no case assumes
that prerequisite is established. The hospital Anschlussheilverfahren form stays
with the hospital.

At authoring time, `packages/knowledge/catalog`, `processes` and `forms` contain
no records, so benefit/process/form IDs and complete required-attachment rules
cannot be asserted. Existing office directory IDs are referenced and checked
against their files. Directory membership establishes an enquiry contact, not
benefit jurisdiction. PVA, ÖGK, FSW, SVS and BVAEB contacts are selected only in the
appropriate confirmed/candidate context. Moved or conflicting subjects are not
silently routed by the letter's historical address.

The checklist therefore asserts what the actual application supports: the
approved imported letter is held and the physician statement must be obtained
from the treating team when absent. Further requirements must be reconciled
against the runtime catalog or official acquired form. Missing rules are an
explicit verification task; claiming a complete checklist without them fails.
No fixed income limits, fees, reimbursement boxes, availability, appointment dates,
booking URLs or release-time rules are invented in this dataset.

## Question baseline and ordering decisions

`questions.baseline` is `runtime_process_engine`: compare atomic missing-fact
requests with a replay of the same process state, counting repeated requests
again and excluding goal/consent/approval prompts. `mustClarify` lists the variant's
specific unknowns/conflicts; it is not the complete engine slot list and is not
a fabricated numeric minimum. No process definitions are present to establish
that minimum offline. Unavailable baseline means unverified question efficiency,
not zero excess. Measured E4 runs report median excess 0 and p90 at most 2 targets.

FR-D9 explicitly requires a checklist before filling; this suite follows that
requirement despite the overview diagram listing applications before documents.
English answers and administrative label explanations follow FR-L1; medical
recommendations remain exact German source quotes, preserving FR-D3 and §4.
The simple-language rubric requires a recorded readability review, not an
unvalidated numerical reading-age threshold.

## Manual medical-boundary review

Reviewed all 20 openings, persona facts, expected outcomes, source excerpts and
nine rubric anchors against PRD §4. Expected answers provide administrative
navigation, applicant-field assistance, conditional support checks and exact-name
coverage lookup only. They contain no diagnosis, interpretation of findings,
personal medical risk, clinical suitability judgement, therapy choice, medicine
recommendation or dosage advice. The source recommendation retains its timing
qualifier; it is never converted into the assistant's clinical conclusion.
The treating team owns clinical decisions and the physician/hospital sections.

The four named substances on page 3 are lookup inputs, not recommended medicines.
Substance-level coverage is shared-status or explicitly pack-dependent, with no
suggested product. The unspecified further medicines are not guessed. Medical
questions go to the treating doctor or pharmacist. An automated phrase regression
guard supplements this editorial review; it does not prove medical safety of
future system transcripts. Human confirmation of boundary labels remains required.

## Validation

From the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e4/s3
```

The loader tests validate every case/persona, rubric schema and anchors, both
languages and all requested dimensions, source links/passages in repository files
and real PDFs, office references, the original document hash, unique openings,
subset selection and the manual-review record. No model or paid service is used.
