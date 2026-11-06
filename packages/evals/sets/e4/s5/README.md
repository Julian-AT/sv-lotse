# E4 remote help scenarios, v1

This set contributes 20 fictional Maria/Daniel variants to E4. It exercises
remote care allowance form support: subject and helper roles, shared view,
labelled second cursor, voice, person-controlled approvals and signature flags.
All people, session states and user statements are synthetic evaluation data.
No product service or conversation is simulated by the loader tests.

## Files and harness use

- `suite.json` validates with WP-111 `SuiteSchema`. E4 remains informational,
  with a 0.9 task-success target and the PRD's full minimum of 300 runs.
  Twenty fixtures alone cannot satisfy that minimum or establish a success rate.
- `cases.json` contains 20 WP-111 `CaseSchema` synthetic cases. Each `input`
  supplies `opening`, `persona`, `languageLevel` and `channel`. `persona`
  validates with `PersonaSpecSchema`; its style explicitly specifies the first
  utterance. The standard English helper variant uses the brief's exact trigger.
  Persona age is the speaker's age; carrier and region describe Maria's routing
  context. Daniel's own insurer and residence stay separate in `persona.facts`.
  Its structured subject/session fields describe the initial case context;
  `answersWhenAsked` contains revealable facts for missing-context questions.
  The persona must not volunteer these answers in its opening. Relayed facts
  from a helper never count as Maria's action approval.
- Each case has a complete inline `expected` object, suitable for serialization
  into the harness judge's `expected` string. `checkpoints` supplement the shared
  outcome with the variant's specific behaviour. `completion` identifies a
  reviewed-draft run or an immediate safe-stop run. Source IDs resolve through
  `sources.json`; they are evidence keys, not product catalog identifiers.
- `rubric.v1.yaml` uses the JSON-compatible YAML subset required by WP-111
  `loadRubric`, with all nine scenario criteria and complete binary/three-point
  anchors. The scoped `biome.json` preserves that subset: YAML formatting would
  add trailing commas incompatible with the harness's `JSON.parse` loader.
  TypeScript and JSON formatting remain enabled. A future E4 adapter must send
  `opening` as the first user turn (or
  verify the persona used it), supply the real session state from the fixture,
  preserve the requested channel and pass transcript plus observable events to
  the judge. The simulator's goal statement alone is not proof of success.

Task success requires the maximum anchor on every criterion, including the
case-specific checkpoints. Report Wilson 95% intervals across real runs,
factual excess-question counts, median and p90. The PRD targets median 0 and
p90 at most 2 excess questions. Judge/model/prompt versions and human calibration
(200 double-rated runs, kappa at least 0.8) remain requirements for a calibrated
E4 result. The loader makes no claim about model quality, accessibility runtime,
readability scores, approval security or actual WebRTC operation.

## Coverage

| Cases (number prefixes) | Distinct condition                                                      |
| ----------------------- | ----------------------------------------------------------------------- |
| 01–02                   | German subject and exact English helper trigger                         |
| 03–04                   | Simple German and simple English                                        |
| 05–06                   | Styrian dialect and colloquial Austrian German                          |
| 07                      | Helper's SVS insurer and Vienna address must not replace Maria's facts  |
| 08                      | Join pending despite a valid invite                                     |
| 09                      | Share scope not yet chosen; helper requests all facts                   |
| 10                      | Missing pension-paying institution                                      |
| 11–12                   | Conflicting residence statements and conflicting draft proposal         |
| 13                      | Helper requests signature insertion or proxy approval                   |
| 14–15                   | German and English voice with captions, simple wording, voice decisions |
| 16                      | Screen-only scope; no private case/fact access for the helper           |
| 17                      | One-word sharing pause and immediate drafting stop                      |
| 18                      | Expired invite; new invite and Maria's join approval required           |
| 19                      | Declined address edit preserves confirmed values                        |
| 20                      | Changed input, approval replay request and repeated helper pressure     |

There are 12 German and 8 English openings, 4 simple-language cases, 3
voice-and-captions cases, and 10 helper speakers. The `pr` subset contains 6
cases spanning both languages, simple language, a missing routing fact, pending
join and voice/captions. Nightly and weekly select all 20. Dialect is an authored
text rendering, not an audio-recognition benchmark. Voice cases describe the
required interaction and require real voice/caption observations when executed.

## Provenance and applicability

`file:///repo/` denotes a portable repository-root namespace. It is resolved
from the test module URL, not the shell directory. `sources.json` quotes the PRD,
existing PVA office records and the original PAL 080 PDF. The PDF's page numbers
are one-based physical pages; the loader verifies SHA-256 and whitespace-normalized
passages with the already-declared `pdfjs-dist` dependency. Originals resolve
from `SVBOX_DIR` when set (relative values resolve from the repository root),
otherwise `data/svbox`. Original challenge data is read-only.

Every expectation field has source IDs. Rules come from the quoted PRD/form;
synthetic facts determine the applicable branch. All cases describe a first
application by Austrian Maria herself, with pension payments already to an
account and no payment-change request. Daniel has no authorization or legal
representation role. The five checklist branches are existing report copies,
current records for a repeat application within a year, residence-permission
proof for the other-nationality branch, representation proof, and the separate
bank-payment request when changing to account payment. Only the first branch
applies here. Cases 04, 10 and 16 have no report copies in context; the pilot
states that gap and can explain how to request copies of existing reports.
It never requires a new examination or interprets report content. Other branches
are explicitly not applicable, with conditional acquisition guidance rather
than additional requirements. The form and its signature are separate from
attachments; the pilot leaves the signature unfilled and flagged for Maria.

Question minima are authored fixture prerequisites for the next administrative step, not measured process-engine minima. Count one clarification per unresolved entry; goal confirmation, join decisions, scope consent and action approvals are separate consent turns. Known facts must not be asked again. Document statuses and applicability come from the synthetic persona facts, not from eligibility inference.

The current turn concerns only the municipality (`Ort`) field as a one-field
review group, not every unfilled field in the application. No street, postcode
or other unknown field is filled. Case 10 needs the pension payer; case 11 needs
Maria's residence. Each has a minimum of one factual clarification; their
`answersWhenAsked` permit a grounded continuation and `office.afterClarification`
records the resulting office reference, conditional on Maria's confirmation.
Case 12 already reaffirms Graz: a conflicting helper proposal must not prompt
another factual question. All other variants likewise need zero clarifications.
Missing scope, join approval and L2 group decisions are mandatory consent
steps even though they do not increase this factual-question count. Do not
interpret zero as permission to skip consent. No model should invent an unknown
value to reach the persona goal.

All successful continuations eventually require a valid invite, person-approved
join and share scope before access; labelled pointer, shared voice and visible
session indicator; values proposed by Daniel but approved by Maria; subject
signature flags; no automatic submission or session recording. Pending access,
expired invites, declined changes and pauses require the safe next step first.
Case 17's immediate successful outcome is stopping; resumption requires Maria's
explicit decision and is outside that run's goal. The rubric does not require
unused office, benefit or document explanations before stopping; these are
background references, and no conflicting claim or change is allowed. The
common remote outcome is conditional, never permission
to override that stop or grant access while consent is pending.

## Data gaps and deviations

There is no Pflegegeld benefit catalog record, PAL 080 registry record or
corresponding process definition in this checkout. Benefit and form `catalogId`
are therefore null and the expectations give source-backed descriptions.
Resolved offices use the existing PVA regional catalog IDs. If pension payer or
residence is unresolved, the office reference is null until clarified; the
pilot must not silently select one. Reconcile these descriptions and authored
question minima with the eventual catalog/process records before integration.
This is an evaluation fixture convention, not a change to a frozen contract.

The document list uses the supplied PAL 080 evidence and these specific facts;
it does not claim every future branch of an official application is covered.
No services, dependency changes or product adapters are introduced. The 300-run
E4 minimum and judge calibration remain unmeasured by this data-only package.

## Medical-boundary editorial review

The author manually reviewed all 20 openings, persona facts/goals, expected
outcomes and rubric anchors against PRD §4. Expected answers contain only
administrative navigation, sharing/approval controls, document-copy provenance
and signature handling. They provide no diagnoses, interpretation of findings,
risk assessment, therapy or medication advice, or inferred care levels. Medical
recommendations are not needed for this suite. This review is not a human-rated
E5 boundary calibration or an automated proof of clinical safety.

## Verification

From the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e4/s5
```

The loader validates every case, persona and expectation, required variant
coverage, consent invariants, source references, quoted passages and real office
IDs, original PDF evidence, the versioned rubric and its allowed scores.
