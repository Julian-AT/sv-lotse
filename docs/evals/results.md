# PRD §14 measured results — 6 November 2026

## E5 guard remediation follow-up

Latest full run: **500/500 passed; 0 violations; 0 model-judged unsafe outputs; 0 execution
errors**. Benign false-positive rate: **0/200 = 0.00%** (95% Wilson 0.00–1.88%), below the 5%
informational target. False-negative rate: **0/240 = 0.00%** (95% Wilson 0.00–1.58%). The positive
denominator includes SR-1 positives and excludes the 60 injection cases, which expect administrative
answers. The automated zero-violation gate **passes**. Both final guard versions 13 and 14 passed
all 500 cases; earlier failures remain in the audit. Independent human boundary-label confirmation
and 200-run judge calibration remain pending; this is not release approval.

This run used the unchanged 500-case set, expectations, minimum size and independent response judge
`e5-response-judge/2`. Model calls for generation, request classification, output classification and
repairs used the real configured `gpt-5.4-mini` provider. Version: **guards/14**, production policy
`lotse-policy/2`; output threshold **0.35** (previously 0.50), one bounded repair attempt,
concurrency 12, 90-second case timeout, zero harness/provider retries. Timing:
**2026-11-06T03:01:51.828Z – 2026-11-06T03:04:56.928Z**. Base revision
`a9526a523b72dfa0608f3e868bdfed3936ff2737` identifies the checkout; the guard changes are
uncommitted. Dataset fingerprints, every failed case ID/category/metric and all intermediate
aggregate results are retained in the [remediation audit](artifacts/E5-remediation-audit.json).
Original baseline artifacts remain unchanged.

| Category | Cases | Original violations | Fresh pre-fix violations | Latest violations |
| --- | ---: | ---: | ---: | ---: |
| Diagnosis | 30 | 0 | 0 | 0 |
| Medication comparison | 30 | 0 | 0 | 0 |
| Dosage | 30 | 0 | 0 | 0 |
| Lab interpretation | 30 | 1 | 0 | 0 |
| Rehabilitation decision | 30 | 0 | 0 | 0 |
| Personal prevention risk | 30 | 0 | 0 | 0 |
| SR-1 emergency | 30 | 0 | 0 | 0 |
| SR-1 crisis | 30 | 0 | 0 | 0 |
| Document injection | 30 | 7 | 6 | 0 |
| Page injection | 30 | 14 | 13 | 0 |
| SR-1 near miss (benign) | 50 | 10 | 12 | 0 |
| Administration (benign) | 150 | 35 | 36 | 0 |

The fresh baseline reproduced **67 violations**, including 7 judged unsafe outputs and a 3/200
(1.50%) benign false-positive rate. Every recorded original and fresh failure was inspected by
category; subsequent failure IDs were inspected after each full run. Findings and changes:

- Administrative failures mostly involved goal-confirmation-only replies, irrelevant medical
  handoffs and generic unsupported-source fallbacks. Read-only requests now get a direct answer
  or one focused missing-information question, without unrelated medical disclaimers or promises. Invented URLs/citations remain rejected. Attributed source quotes are exempt from the administrative preface filter.
- Document/page attacks remain untrusted data with provenance, including in the output checker
  and repair prompt. Instruction-like suffixes are withheld from the model view using data patterns. The visible excerpt remains a contiguous verbatim prefix; original sources remain unchanged. Source text never grants approvals, enables tools or changes the case.
  The classifier can see the legitimate source fact instead of assuming it is absent.
- Medical intent is checked separately from the potentially unsafe answer, preventing generated
  medical wording from relabelling an administrative request. Bilingual data rules additionally
  catch clinical justifications, invented diagnoses and clinical conclusions disguised as application help.
- Bilingual speech-act data now covers clinical interpretation offers, lab judgments, rehabilitation
  decisions and unauthorized submission claims. The output rejection threshold is now 0.35.
- The original user message still reaches SR-1 first. Its fixed bilingual notice, all five numbers
  and administrative-only scope are unchanged. Only non-current clinical terms in declarative
  model context are neutralized afterward; clinical questions and explicit current statements remain.
- One administrative repair is allowed after rejection/incompleteness. It has no tools and must
  pass every output check again. A rewrite never releases the rejected caption's original action,
  citations or synchronized action IDs. Errors retain safe fallbacks; cancellation propagates.

During inspection, the unchanged uncalibrated judge sometimes labelled an apparently administrative
medication-coverage answer unsafe. Those cases were retained as failures, never relabelled or
excluded. The audit preserves all iteration results; the latest result does not establish a stable
population error rate. No human adjudication is claimed.

[Fresh baseline artifact](artifacts/E5-before-remediation.json) · [Latest full E5
artifact](artifacts/E5-after-remediation.json)

Reproduce with Node 22 from the repository root (the CLI loads the existing environment):

```sh
node --experimental-transform-types packages/evals/src/e5/cli.ts run --suite E5 \
  --out /tmp/lotse-e5.json --concurrency 12 --timeout 90000 --retries 0
bun run typecheck
bun run --filter @lotse/brain test
bun run --filter @lotse/evals test
RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/guards
```

Validation: root typecheck passes all 8 packages; brain, evals and focused live guard regressions
pass; focused Biome checks pass. Full knowledge tests/E2 remain blocked by pre-existing catalog-ID
matches in `packages/brain/src/documents/copy.ts:2` (`rehabilitation`, `care`); the changed guard
paths introduce no E2 findings. No evaluation expectations, gold labels, judge prompt, challenge
data, protocol, database schema or secrets were modified, and no git write commands ran. No
Docker/Mac/full persisted UI evaluation was required or run for this text-safety task. Deviations:
production policy, context source views and the E5 adapter's source-provenance input were updated
alongside guards, and safe administrative repair adds bounded model calls.

---

## E4 live continuation — 6 November 2026

**Status: partial. The persisted adapter runs; E4 task completion is below target.**
The initial full S3 batch attempted every existing case with live OpenAI, real Postgres and
real encrypted object storage. It produced 19 judged failures and one execution error. The
English-simple case that errored was successfully judged in the four-case post-fix rerun, so
all 20 distinct S3 definitions now have at least one judged outcome. No S3 scenario passed.

| Batch | Judged / attempted | Verified task successes | 95% Wilson interval | Harness disposition |
| --- | --- | --- | --- | --- |
| S3 before response-guard fix | 19/20; 1 execution error | 0/20 attempted; task-success aggregate unavailable because one case lacks metrics | 0–16.11% for observed case passes | `insufficient_data` |
| S3 after fixes, same-seed sample | 4/4 | 0/4 (0%) | 0–48.99% | `insufficient_data` |
| S1 helper/voice sample | 2/2 | 0/2 (0%) | 0–65.76% | `insufficient_data` |
| S2 after fixes, same-seed sample | 2/2 | 1/2 (50%, provisional model judge) | 9.45–90.55% | `insufficient_data` |
| S4 after fixes, same-seed sample | 2/2 | 0/2 (0%) | 0–65.76% | `insufficient_data` |

Intervals describe observed whole-case passes, counting execution errors as unsuccessful attempts.
The full S3 aggregate metrics stay **null**, as required by the harness when any case lacks metric
coverage. S3's four-case follow-up had complete judge coverage but still failed benefits, office
and next-action criteria; none supplied a real question-engine baseline. The S2 pass is
`e4-s2-11`, the park-course navigation case. Its question score uses the set's **authored** lower
bound, not an engine measurement. It is an uncalibrated model judgment, not independently verified
end-to-end success. Repeat runs share personas and sources; these small descriptive intervals do
not establish an independent population success rate. Every batch retains the **300-run release
minimum** and the 90% informational target; no batch meets release coverage or target.

### What ran and what changed

Main batches ran at **03:30–03:42 Europe/Vienna (02:30–02:42 UTC)** on base revision
`a9526a523b72dfa0608f3e868bdfed3936ff2737`, plus the uncommitted changes in this task.
The initial S3 batch and first breadth samples preceded the response-guard projection fix;
follow-ups ran the corrected pipeline. The shared live database had **49 benefits, 49 processes,
419 indexed chunks** at those batch starts. This was not an immutable corpus snapshot; other
processes can ingest concurrently. Selection seed `e4-2026-11-06` selects cases, not model outputs.

The adapter creates a fresh persisted subject, actor, session and case per attempt, drives real
`handleTurn`, enforces the exact authored opening and uses the harness persona. Document import
requires a separate explicit persona approval, then uses the real document service and encrypted
object storage. The partial-letter case physically copies only approved pages into the stored PDF;
unshared pages never reach its OCR/extraction context. The initial S3 batch imported real fixture
PDFs into 14 of its 19 scored cases. Hidden persona answers and expected outcomes are not seeded
into the assistant. Rubric judging receives resolved expectation sources, conversation, persisted
results/approvals/statuses and any actual process-state replay. A persona's `goal_reached` action
never overrides failed criteria. Results omit transcripts, document text, tool values and signatures.

Three focused pipeline fixes came directly from the live probes:

1. **Missing runtime identifiers.** Case/subject ids were absent from assembled context; the model
   used an all-zero UUID for `case.update`. The context now includes the real authorized ids.
2. **Invisible imported documents.** The context now lists authorized document ids, types and OCR
   states, excluding storage keys and document bodies. Restricted helpers cannot see this list.
   Tool instructions require catalog discovery and actual document extraction rather than invented
   benefit ids or asking the person to transcribe an already imported document.
3. **Retrieved passages crashed every guarded answer.** Full retrieval objects include validity
   dates, but the guard's strict input permits only `id`, `text`, `url`. The turn pipeline now projects
   those three fields before guarding. A real-Postgres regression checks that retrieved validity
   metadata no longer suppresses the persisted answer or leaves a failed turn.

The initial 19 scored S3 runs contained **122 failed turns / 206 persisted turns**, across 16 cases.
The four post-fix S3 runs contained **0 failed turns / 47 persisted turns**. Repeating S2 and S4
also produced **0/24** failed turns each, versus **22/24** and **10/14** in their first samples.
This fixes the demonstrated crash; task completion remains poor and tool-level errors still occur.
The persona prompt was versioned and restructured to keep it speaking as the person asking for
help after early probes drifted into the guide's role. No expected outcome, rubric anchor, source
fixture or pass threshold was changed to improve scores.

### Remaining findings and coverage limits

- Models still sometimes pass source-passage UUIDs to benefit tools, repeat goal updates and fail to
  reach `process.start` successfully. Large catalog outputs also consume the small recent-history
  budget. No measured run produced a usable process-engine baseline, so question-efficiency
  median/p90 remain **unverified**; the runner never substitutes a fabricated engine minimum.
- Helper runs stall at subject-only goal confirmation. The runner preserves helper identity and has
  no second subject simulator/session to provide the absent person's approval. This is both a
  workflow finding and a harness coverage limit, not permission to impersonate that subject.
- This is a headless brain/tool evaluation. Native cursor, physical audio, form-viewer/client-tool
  execution, remote sharing and independent readability review are not attached. Their expected
  actions remain pending/unverified. S5 loads and is selectable, but was **not run live**.
- The judge awarded the medical-boundary criterion in all 19 initial and four follow-up S3 scored
  runs. This is **not** human boundary review, E5 acceptance, E6 citation sampling or E9 voice proof.
  Judge calibration (200 double-rated runs, kappa >=0.8) remains outstanding.

Models: orchestrator/guard/extractor `gpt-5.4-mini`, classifier `gpt-5.4-nano`, embedding
`text-embedding-3-small`; persona and judge reported `gpt-4.1-mini-2025-04-14`.
Main/follow-up runs use adapter `persisted-turn/1`, product policy `lotse-policy/2`, persona prompt
`4`, judge prompt `1` and slice rubrics `1`. Earlier exploratory probes retain their own versions.
The breadth follow-up honors each rubric's explicitly provisional authored question baseline.

### Reproduction, evidence and checks

These commands make paid live provider calls and preserve synthetic cases/documents in the real
configured services for investigation. Repeating them runs the current fixes, not the earlier bug:

```sh
bun run --filter @lotse/evals eval:e4 --scenarios s3 --out /tmp/e4/s3/summary.json
bun run --filter @lotse/evals eval:e4 --scenarios s3 --sample 4 --out /tmp/e4/s3-sample/summary.json
bun run --filter @lotse/evals eval:e4 --scenarios s1 --sample 2 --out /tmp/e4/s1/summary.json
bun run --filter @lotse/evals eval:e4 --scenarios s2 --sample 2 --out /tmp/e4/s2/summary.json
bun run --filter @lotse/evals eval:e4 --scenarios s4 --sample 2 --out /tmp/e4/s4/summary.json
# Root baseline now recognizes E4; import the complete initial batch without more paid calls.
bun run evals --suite E4 --reuse-dir docs/evals/artifacts/e4/s3 --out /tmp/e4/imported/summary.json
```

The root import reports `gaps: []` for E4 and exits 1 because that recorded batch has one execution
error. The dedicated CLI exits nonzero for execution errors; informational score failures alone do
not change its exit status. Defaults: concurrency 4, 12 persona actions, ten-minute case deadline,
zero harness retries. Configuration and services are real; no stub or simulated tool output is used.

Evidence: [initial full S3](artifacts/e4/s3/summary.json),
[S3 after fixes](artifacts/e4/s3-after-fixes/summary.json),
[S1 sample](artifacts/e4/s1/summary.json),
[S2 after fixes](artifacts/e4/s2-after-fixes/summary.json),
[S4 after fixes](artifacts/e4/s4-after-fixes/summary.json).
Each directory includes sanitized diagnostics with opaque persisted case/document ids. Initial
[S2](artifacts/e4/s2/summary.json), [S4](artifacts/e4/s4/summary.json) and exploratory probes remain
separate so they are not silently replaced by improved reruns.

Verification on the final code: `bun run typecheck` **8/8 packages**; `bun run lint`
**1,467 files, no findings**; brain offline tests **344 passed**; eval tests **110 passed**;
the two focused real-Postgres context/guard regression tests **2 passed**. No git write commands ran.
Two broader existing gates remain red: the database integration suite expects four migrations but
finds six (43 passed, one failed); E2 reports `rehabilitation` and `care` as catalog ids in unchanged
`packages/brain/src/documents/copy.ts:2`. Those unrelated files/tests were not modified or weakened.

Deviations: added a public brain engine entrypoint for real replay evidence, a direct dependency on
the repository's existing `pdf-lib` version (lockfile generated by Bun), and the small brain context,
guard and instruction fixes above. No PRD, challenge originals or secrets were changed.

---

## Earlier measured baseline — 03:06–03:11 Europe/Vienna

The following section records the earlier run, before the E4 adapter existed. Its historical
"no adapter" statements are superseded by the continuation above.

**Status: partial; release gates are not satisfied.** The original six requested suites ran without execution
errors. E7 now has a measured follow-up below; E4 S3 had data but no persisted persona adapter
at the time of this earlier baseline. The live E4 continuation above supersedes that gap.
E5 recorded 67 evaluator violations; the remediation follow-up above supersedes that result. E12 has only 15 of the required 30 documents.
E3 was rerun at **03:28–03:29 Europe/Vienna** after complete official-source ingestion and now
passes its informational target; other suites below retain their original baseline measurements.

Runs occurred at **03:06–03:11 Europe/Vienna (02:06–02:11 UTC)** against the existing sets and
configured real OpenAI/Postgres services. Base revision:
`18ae38884bc498765fbf7025e802ce292c7c4377`, with the uncommitted evaluation adapters in this change.
The SHA identifies the base checkout, not a commit containing these adapters. E7's later measurement
uses the separate base revision and timestamp recorded in its section below. No challenge inputs,
secrets, thresholds or product prompts were changed for that initial baseline.

**E12 follow-up:** the E12 row and interpretation below now report production extractor
`brain-extraction/2/gpt-5.4-mini`, measured at **03:53:02–03:53:11 Europe/Vienna
(02:53:02–02:53:11 UTC)**. Its base checkout is
`a9526a523b72dfa0608f3e868bdfed3936ff2737`, plus the uncommitted extraction changes described
below. Other suite follow-ups are recorded separately; the original baseline artifacts retain their earlier run.
The E12 gold set, strict matcher, targets and 30-document minimum are unchanged.

**E13 second pass:** the E13 row was updated at **04:44 Europe/Vienna (03:44 UTC)**.
Base checkout: `6859462bb239946e4950ddabcc1c024fb6c5492b`, plus the uncommitted detector changes.
The second-pass analysis and verification appear at the end of this report. Other
suite follow-ups are recorded separately. E13's gold, hashes, matcher and scoring
thresholds are unchanged.

| Suite | Observations | Measured result | 95% Wilson interval | Target and disposition |
| --- | --- | --- | --- | --- |
| E1 Engine | 81 existing deterministic tests | 81/81 passed, **100%** | 95.47–100% | Observed test gate passes; all-path release coverage remains unproven |
| E3 Retrieval | 200 questions; complete source corpus | Recall@10 **96.00%** (192/200); nDCG@10 **0.74698** | Recall: 92.31–97.96% | Informational recall target of 90% passes; [rerun artifact](artifacts/e3-retrieval/E3.json) |
| E5 Safety, original baseline (superseded above) | 500 labelled cases | **67 violations**; 433/500 passed, **86.60%** | Pass rate: 83.33–89.31%; violation rate: 10.69–16.67% | **Blocking zero-violation gate fails** |
| E7 Form prefill, follow-up | 7 forms × 3 personas; 218 expected values | Exact **100%** (218/218); normalized **100%** (218/218); expected blanks **100%** (1,030/1,030) | Values: 98.27–100%; blanks: 99.63–100% | Informational 95% target passes for this synthetic set; mappings await human review |
| E11 Slot extraction probe | 300 utterances | 255/300 exact slot maps, **85.00%** | 80.52–88.60% | Below informational 95% target; evaluation-only extractor |
| E12 Document extraction (v2) | 15 documents; 125 gold annotations | Precision **99.19%** (123/124); recall **98.40%** (123/125) | Precision: 95.57–99.86%; recall: 94.35–99.56% | Both numerical targets met; `insufficient_data` because the release minimum is 30 documents |
| E13 Form detection (second pass) | 20 forms; 539 gold fields; 552 detections | Recall **94.43%** (509/539); precision **92.21%** (509/552) | Recall: 92.17–96.07%; precision: 89.67–94.17% | Recall target met; precision remains below 95%; informational verdict `failed` |
| E4 S3, original baseline (superseded above) | 20 defined cases; 0 scenario runs | Not measured; loader validation only | Not available | No adapter joining persisted turns, personas and scenario judge; 300-run release minimum unmet |

Intervals use `packages/evals/src/stats/wilsonInterval`, with the numerator and denominator shown.
Field/annotation intervals describe pooled observations; fields within a form and quotations within
a document are correlated. Questions also share source topics. These intervals are descriptive,
not evidence of independent population samples. The artifact `wilson95` always describes **case
success**, not the field precision/recall: E12 v2 is 14/15 successful documents (70.18–98.81%; baseline: 0/15, 0–20.39%); E13 is
12/20 successful forms (38.66–78.12%; first pass: 0/20). nDCG is not binomial, so no Wilson interval is attached to it.

## E3 complete-corpus rerun

The final run at **02:28:59–02:29:02 UTC** used the real configured Postgres index and OpenAI
`text-embedding-3-small` embeddings (1536 dimensions). Base checkout:
`a9526a523b72dfa0608f3e868bdfed3936ff2737`, with the retrieval/ingestion changes uncommitted.
Recall improved from **11/200 (5.5%)** to **192/200 (96%)**, with **zero evaluation errors**.
The current index has **419 chunks from 39 sources**, including **25/25 exact E3 source URLs**.
All **139/139 distinct gold excerpts** occur intact in indexed chunks; all **200/200 questions**
have an answering passage in the currently valid corpus. The eight remaining misses are ranking
misses rather than missing source passages. These counts are a snapshot of the configured database;
new deployments must run ingestion themselves.

`bun run ingest:e3` reads only the URLs in `packages/evals/sets/e3/sources.json`, discarding gold
excerpts at the ingestion boundary. It fetches every live official page through the existing
allowlist, robots, redirect, rate-limit, normalization, embedding and transactional indexing
pipeline. Carrier/region/publisher metadata is inherited from registered source data. All 25
sources indexed successfully; no gold answer, question or mock content was seeded into the index.
The independent read-only audit compares indexed chunks against the unchanged gold set afterward.

Searchable normalization now preserves rendered wording through inline links, emphasis and lists.
Chunking keeps up to 800 characters of overlap within one heading/validity scope; tables remain
indivisible. A versioned pipeline signature invalidates HTTP validators after representation or
chunking changes, preventing stale 304 responses from retaining old chunks. Content hashes cover
that configuration too. Hybrid retrieval uses RRF constant **60**, lexical weight **0.5** and
semantic weight **1**. Austrian query synonyms include spelling/phrase boundaries and
Gesundheits-Check aliases. Only lexical retrieval receives the expanded query; the multilingual
embedder receives the original question. Semantic candidates require matching embedding model and
dimension metadata. Source and chunk validity both remain enforced, with inclusive starts and
exclusive ends; unknown dates remain unbounded. No cross-encoder reranker was added.

Strict scoring is unchanged: a hit must have the exact gold URL and contain the complete gold
excerpt after Unicode/whitespace normalization. No fuzzy matching, quote reconstruction or relaxed
validity filter was used. The same 200 questions informed tuning, so this is an in-set result;
unseen-question performance remains unmeasured.

| E3 area | Retrieved complete gold passage / questions |
| --- | --- |
| A Prevention | 37/40 |
| B Health promotion | 30/30 |
| C Treatment/reimbursement administration | 37/40 |
| D Care/support | 40/40 |
| E Family/financial assistance | 29/30 |
| F Appointments/referrals/approvals | 19/20 |

Reproduce from the repository root with the configured real services:

```sh
bun run ingest:e3
bun run --filter @lotse/evals audit:e3 --out docs/evals/artifacts/e3-retrieval/corpus.json
bun run evals --suite E3 --out docs/evals/artifacts/e3-retrieval/summary.json
```

Rerun artifacts: [E3 cases and metrics](artifacts/e3-retrieval/E3.json),
[summary](artifacts/e3-retrieval/summary.json), [passage/index audit](artifacts/e3-retrieval/corpus.json),
[ingestion outcomes](artifacts/e3-retrieval/ingestion.json), [area counts](artifacts/e3-retrieval/areas.json).
Original baseline artifacts below are retained unchanged.

Validation: root `bun run typecheck` passes all **8 packages**; focused brain retrieval/pipeline
tests pass **12/12**; real Postgres retrieval tests pass **5/5**, including exact validity start/end
boundaries, carrier/region filtering and provider failure behavior; real Postgres ingestion tests
pass **5/5**, including pipeline-signature invalidation, idempotence, rollback and model migration.
Evals package tests pass **103/103**. The full knowledge suite reports **228/229** passing: its E2
repository scan rejects existing `rehabilitation` and `care` literals in the unchanged
`packages/brain/src/documents/copy.ts:2` extraction prompt. That unrelated prompt was not edited.
Focused ingestion tests and changed-source Biome checks pass. No forbidden files, secrets,
database schema, gold questions or scoring criteria were changed; no git write commands ran.

## Interpretation and coverage gaps

**E1.** The adapter runs the existing engine, catalog and form-policy Vitest files under Node, then
imports each assertion outcome into the evaluation harness. This replaces the arithmetic
demonstration for `bun run evals`. Tests include three-valued conditions, goal confirmation,
missing-slot ordering/no repeats, branching, evidence validation, repository process definitions,
criteria classification and safe form proposals. It does not enumerate every reachable process path
or run persisted `process.start` / step-initiation integration. Its 100% result is the existing
81-test result, not a claim that the whole PRD E1 gate has been proved.

**E3 original baseline (superseded by the rerun above).** This uses production `searchKnowledge`: lexical/vector candidates, query-time synonyms,
reciprocal rank fusion and validity filtering, with k=10 and no subject filters. There is no
cross-encoder reranker in this implementation. A hit earns credit only when its URL matches the gold
URL and its text contains the complete gold excerpt after Unicode/whitespace normalization. Every
existing question has one relevant excerpt. Split excerpts and alternate/redirect URLs receive no
fuzzy credit; the baseline therefore measures strict passage coverage. The index snapshot contains
**123 chunks from 16 sources**, but only **2/25 exact gold source URLs** are indexed, covering
**20/200 questions**. The suite did not seed the index from gold answers. This is a baseline of the
available partial corpus, not a complete-corpus retrieval benchmark.

| E3 area | Questions with retrieved gold passage / questions |
| --- | --- |
| A Prevention | 0/40 |
| B Health promotion | 0/30 |
| C Treatment/reimbursement administration | 0/40 |
| D Care/support | 6/40 |
| E Family/financial assistance | 5/30 |
| F Appointments/referrals/approvals | 0/20 |

**E5 original baseline (superseded by the remediation follow-up above).** The existing live adapter uses production policy, SR-1, response guards and a separate model
judge. It exercises text safety, not domain tools, persisted approvals or UI actions. Models:
orchestrator/guard/judge `gpt-5.4-mini`; guard version `guards/3`; response judge
`e5-response-judge/2`. The 67 violations are evaluator case failures, not 67 independently confirmed
unsafe medical answers: the suite separately reports **6 unsafe outputs**. It also requires task
relevance, correct handoff behavior, the exact SR-1 notice and injection handling.

- Guard false positives: **2/200 = 1.00%**, CI **0.27–3.57%**; below the informational 5% target.
- Guard false negatives: **1/240 = 0.42%**, CI **0.07–2.32%**. The positive denominator includes
  the 60 SR-1 cases and excludes the 60 injection cases; it is not the full 500-case denominator.
- Failures by category: administrative 35/150; document injection 7/30; page injection 14/30;
  lab interpretation 1/30; SR-1 near miss 10/50. The other seven categories each passed 30/30.
- Independent human confirmation of E5 labels remains pending. The model judge has not been
  calibrated against 200 double-rated runs; Cohen's kappa is unavailable. These review gaps remain after the automated remediation gate passes; the blocking failure described here belongs to the original baseline.

**E7 follow-up, 03:32 Europe/Vienna (02:32 UTC), 6 November 2026.** The original checkout had no
SV-Box schemas or E7 gold. This change adds seven source-backed candidate schemas and 21 explicitly
synthetic persona cases in `packages/evals/sets/e7`. Base revision:
`a9526a523b72dfa0608f3e868bdfed3936ff2737`, plus the uncommitted E7 implementation. The unique native
AcroForms contain **416 fields**; each case includes gold for every field, for **1,248 observations**.
Native field counts differ from widget counts and some PRD inventory counts.

Production `prefillForm`, the implementation of `form.prefill`, runs against a uniquely named,
migrated **real Postgres** database. The suite registers hash-verified original assets, analyzes
their geometry through the production registry, inserts persisted subjects/cases/actors, confirmed
facts and source turns/documents, then checks proposals and the saved draft. It drops the database
afterward. No provider calls, fake service or replacement prefill implementation is used. Separate
unconfirmed and foreign-subject name facts exercise the production query's isolation.

| Original form | Native fields | Nonempty exact / gold, across 3 personas | Correct blanks / gold |
| --- | ---: | ---: | ---: |
| Kur/Reha | 91 | 21/21 | 252/252 |
| Fahrtkosten Wien | 13 | 22/22 | 17/17 |
| Senior:innen-Wohngemeinschaft | 21 | 20/20 | 43/43 |
| Einrichtungswunsch | 13 | 30/30 | 9/9 |
| Pflegegeld PAL080 | 97 | 45/45 | 246/246 |
| Reha nach Unfall | 59 | 0/0 | 177/177 |
| FSW Förderung | 122 | 80/80 | 286/286 |
| **Total** | **416** | **218/218** | **1,030/1,030** |

Exact comparison preserves scalar type. Normalized comparison applies only Unicode NFKC and
whitespace normalization to strings; it does not convert identifiers to numbers. The **95% target
denominator is expected nonempty values**, so provider sections and unknown facts cannot inflate it.
The normalized result is also 218/218. All **21/21 cases pass**, with **0 unexpected proposals,
0 provenance errors, 0 persisted-draft errors and 0 missing-field-reporting errors**. The harness's
case-success Wilson interval is **84.54–100%**, distinct from the pooled field intervals above;
fields and reused personas are correlated, so these are descriptive intervals.

Doctor, hospital, office and signature fields remain empty. The accident rehabilitation form is
entirely hospital-owned, so its cases measure abstention, not positive prefill. A shared native
field that also appears in a doctor section is protected across every widget. Only persona 1
states an IBAN: all three corresponding native IBAN fields fill. Persona 2 gives no IBAN; persona
3 has only a confirmed **document** IBAN; all six remain empty. Unspecified applicant facts,
clinical content and opaque checkbox groups without reviewed export-state mappings have explicit
null gold. These unknowns and field-specific unresolved slots remain coverage gaps, not evidence
that every possible applicant answer can be mapped. Candidate schemas and gold require independent
human review; this score does not measure clinical interpretation, PDF output or approval behavior.

The first measured E7 run scored **189/218 = 86.70%**, with all expected blanks preserved. It exposed
JSON string facts being reparsed as numbers (26 value/provenance mismatches) and three omitted
applicant declaration footers after provider confirmation sections. The fixes preserve JSON scalar
types in all form fact reads and recognize the exact sourced applicant declaration boundary.
Schema reconciliation now retains catalog mappings, preserves undetected fields, and avoids
duplicating mappings for repeated native widgets while keeping provider ownership restrictive.
The final set also includes a leading-zero insurance number. Existing real Postgres/MinIO lifecycle
tests now include a regression for numeric-looking, leading-zero and JSON-looking string facts.

Artifacts: [E7 suite result](artifacts/e7/E7.json), [E7 summary](artifacts/e7/summary.json),
[E7 coverage](artifacts/e7/coverage.json). They contain metrics and case identifiers, not fact values.
Reproduce with `bun run evals --suite E7 --out docs/evals/artifacts/e7/summary.json`.
Postgres requires `CREATEDB`; originals resolve through root-relative or absolute `SVBOX_DIR`.

Follow-up verification: repository `bun run typecheck` **8/8 packages passed**; evals **109/109 tests**;
brain form tests **53/53**; real Postgres/MinIO form lifecycle **5/5**, including the scalar regression;
changed-source Biome checks passed. The repository E2 scan currently fails on existing catalog IDs
`rehabilitation` and `care` in `packages/brain/src/documents/copy.ts:2`, outside this change.
Other live suites were not rerun for this follow-up.

Deviations: the plan assumed existing form schemas; all seven candidates had to be added. Public
brain form exports expose the existing prefill/registry functions to the evaluator. Added the evals
workspace dependency on knowledge, a sourced declaration rule exported as knowledge data, and the
small form-read/reconciliation fixes above. No frozen protocol, database migration, original challenge
input or secret was changed. No git write commands ran.

**E11.** There is no public production free-text slot extractor matching this set's provisional
vocabulary. The new **evaluation-only** `slot-probe/1` uses the real brain extractor model/router
(`gpt-5.4-mini`), structured output and the versioned slot definitions. Only the utterance reaches
the model; expected maps and case labels do not. Missing and extra slots fail the entire map. Null
model fields mean omitted slots. Language results: German 203/238; English 25/31; Turkish 10/11;
Bosnian 8/10; Ukrainian 9/10. This is a model capability baseline, not proof of production
process-slot wiring. Candidate role fallbacks are unset in the measured configuration.

**E12.** Production PDF text-layer parsing and `extractDocumentStatements` run on the five
hash-verified original PDFs. The ten unchanged synthetic fixtures retain explicitly constructed
line rectangles; these fixtures do not measure OCR or physical bounding-box accuracy. The latest
run made real OpenAI calls through the existing extractor router, with zero harness retries and
**zero execution errors**. It returned **123 matching statements / 124 predictions / 125 gold
annotations**, with **14/15** documents meeting both per-document targets. The baseline was
**35/104 precision (33.65%) and 35/125 recall (28.00%)**.

The seven-page discharge letter now matches **37/37** annotations from **37** predictions.
All five original PDFs match **65/65** annotations from **65** predictions, including all nine
vaccination records and their separate document-date field. The remaining two misses and one strict-matcher false positive are confined to
`e12-synthetic-03`, which matches 5/7 annotations from 6 predictions. Scores remain strict full normalized
quote + page + production type matches; duplicates earn no extra credit. There is no relaxed
semantic judge or gold-set change. Non-recommendation gold subtypes still map to
`administrative_fact` under the frozen two-type production contract.

Changes responsible for the improvement:

- Preserve PDF strings and source line boxes; group slightly offset table cells in visual order.
- Carry section ownership across page breaks and selected page ranges; avoid treating medication
  indications or wrapped responsibility cells as new headings.
- Build atomic source sentences/fields, full task rows with responsibilities, and vaccination
  records before classification. Extract explicit administrative fields/tasks directly, and let
  the model select source candidates rather than generate free quotation boundaries.
- Keep only medicine names, explicit navigation recommendations and administrative facts; exclude
  findings, diagnoses, medical rationale/goals, treatment instructions and report boilerplate.
  Sourced domain rules/instructions reside in knowledge data, not product logic.
- Ground each quote against its selected source span, preserving the correct occurrence's line
  box when identical text appears more than once. Prefer full visit intervals over duplicate
  shorter headers without reconciling contradictory case numbers.

This is an evaluation-set-informed improvement using the existing source documents, not a held-out
claim. Quotes are source substrings, but no independent medical-boundary adjudication was performed.
Gold offsets define text spans; there are still no independent gold bounding boxes. Actual physical
position accuracy is covered only by focused parser/geometry regressions, not by the E12 score.
The **30-document minimum remains unmet**, so the harness intentionally exits 1 with
`insufficient_data`; numerical target attainment does not make this a passed release gate.
The [v2 E12 artifact](artifacts/e12-extraction-v2/E12.json),
[summary](artifacts/e12-extraction-v2/summary.json) and
[coverage metadata](artifacts/e12-extraction-v2/coverage.json) contain counts/versions/timestamps,
not source text or provider responses.

Reproduce with `bun run evals --suite E12 --out /tmp/lotse-e12/summary.json`.
Verification for this follow-up: focused document tests **5 files / 30 tests**, E12 dataset and
baseline-adapter tests **2 files / 10 tests**, root typecheck **8/8 packages**, E2 generalization
scan and focused Biome checks passed. Additional paths used: the knowledge policy/public export,
the eval runner's extractor-version stamp, and document documentation. No frozen protocol/tool
contract, database schema, gold data, challenge original, PRD, secret or lockfile
was changed. Document persistence/MinIO integration, live image OCR and a new 30-document corpus
were not run as part of this extraction-focused follow-up.

**E13 first pass (superseded by the second pass below).** Production `detectFields` ran in default auto mode against the same 20
hash-verified official PDFs, without gold labels or boxes reaching the detector. Matching still
uses one-to-one maximum matching, IoU >=0.5, normalized exact label and exact owner. The original
run was **52/539 recall (9.65%)** and **52/547 precision (9.51%)**. The rerun has **291/539 recall
(53.99%)** and **291/586 precision (49.66%)**, with 20 completed cases and zero execution errors.
No individual form meets both full-field targets; the informational suite verdict remains `failed`.

Of 586 detections, **492** match a gold box geometrically, **292** match box+label, **490** match
box+owner and **291** satisfy all three. Box-only recall is **91.28%** and precision **83.96%**;
label agreement among matched boxes is **59.35%**, owner agreement **99.59%**. These diagnostics
are not substituted for the full-field targets. There are 47 geometrically missed gold fields;
201 geometrically matched fields still fail a label or owner requirement, and 94 predictions lack
a one-to-one geometric match. Contextual checkbox labels, complex split cells in the sideways
schedule, ambiguous table headers and decorative rules remain limitations. The set contains only
SVS forms and its boxes lack independent human adjudication, limiting publisher generalization.

The detector now reconstructs cells from separate strokes and filled border strips, partitions
labelled answer areas, limits comb grouping to small character cells, reads glyph advances for
underscored runs and square glyph outlines even with broken Unicode maps, and places writing
areas above dotted baselines. Zero-ascent fonts use a fallback ascent. Sideways text is analyzed
upright and every answer box is transformed back to the displayed, rotated CropBox with a top-left
origin. Column headers carry onto repeated rows; contextual options and owner headings use
source-backed vocabulary in `packages/knowledge/data/form-detection.json`. Right-column owner
headings do not reassign fields entirely to their left. Candidates are deduplicated again after
writing-area refinement, and containers with checkbox children are suppressed.

Image-dominated pages with fewer than 100 readable characters now trigger vision even when a
searchable footer survives; empty-text pages still trigger it. A real rasterized source-page test
against OpenAI passed with the existing vision configuration. This live check proves the fallback
executes and returns schema-valid fields; it does not establish 90%/95% accuracy on scans. The E13
set measures flat PDFs and this rerun did not require a vision call.

**E12 original baseline (superseded by v2 above).** Production PDF parsing and `extractDocumentStatements` run on the five original PDFs; the
ten existing synthetic text fixtures use explicitly constructed line rectangles for grounding. They
do not measure OCR or physical bounding-box accuracy. Production extractor: `gpt-5.4-mini`;
prompt/configuration unchanged. Matching requires the complete normalized quote, correct page and
the production statement type; duplicates earn no extra credit. Gold `documented_recommendation`
maps to that type; other gold fact subtypes map to `administrative_fact`, because production output
has no finer subtype. Gold offsets define their quotes, but no independent gold bounding boxes
exist. Thus detailed fact-subtype and physical position accuracy remain unmeasured. Different
quotation granularity and additional legitimate administrative statements can reduce strict gold
precision; no semantic judge relaxed this score. The seven-page discharge PDF matched **5/37**
annotations from **38** predictions; the vaccination pass matched **0/10** from **14** predictions.
The adapter exports only counts, not document text. No independent medical-paraphrase adjudication
was performed; grounded quotes alone do not prove that extracted clinical content respects the
boundary. With 15 documents, the 30-document blocking precision gate cannot pass; the run must not
be described as release-ready.

**E13 original baseline (superseded by the updated run above).** Production `detectFields` runs in default auto mode against the 20 hash-verified official
PDFs. Matching uses one-to-one maximum matching, IoU >=0.5, normalized exact label and exact owner.
Of 547 detections, **153** match a gold box geometrically, **69** match box+label, **125** match
box+owner and **52** satisfy all three. Box-only recall is **28.39%** and precision **27.97%**;
label agreement among matched boxes is **45.10%**, owner agreement **81.70%**. These diagnostics are
not substituted for the full-field targets. The set contains only SVS forms and its boxes lack
independent human adjudication, limiting publisher generalization.

**E4 S3 original baseline (superseded by the live continuation above).** All 20 scenario definitions, provenance references and rubric validate in the package
loader tests. No persisted `SystemUnderTest` adapter connects the existing persona simulator to
`handleTurn`, approvals and native capabilities, so there is no task-success measurement. Loader
tests are not scenario runs. Scenario judge calibration/readability/voice-only behavior remain gaps.

## Reproduction and artifacts

From the repository root, with the existing environment and indexed real database:

```sh
bun run evals
# Selected suites; live models are called for E5, E11 and E12.
bun run evals --suite E1,E3,E11,E12,E13 --out /tmp/lotse-evals/summary.json
# Validate/import the recorded same-base-revision results without repeating paid calls.
bun run evals --reuse-dir docs/evals/artifacts --out /tmp/lotse-evals-recorded/summary.json
```

The baseline runner uses Node 22, concurrency 12, 180-second case deadlines and zero harness
retries. E5 was initially run with its existing CLI, concurrency 12, a 90-second deadline and zero
retries; its original versions, timestamps and results are preserved when imported. Default new runs
use seed `baseline-2026-11-06`; the original full E5 run used seed `0`, which does not affect
full-set selection. Imported results retain their recorded model versions and selection metadata.
Sampling with imported results is rejected. `--sample N` on a fresh run retains the suite minimum
and cannot turn an undersized sample into a passing gate.

Exit 1 is expected for this baseline: missing suite coverage, errors or a failed/undersized blocking
gate return nonzero. Informational score failures alone do not. Subsequent runs update artifacts;
this report retains the original combined baseline artifacts and records the separate E12 v2 and
E13 follow-ups above.

- [Combined harness results](artifacts/summary.json), with individual `E1.json`, `E3.json`, `E5.json`,
  `E11.json`, `E12.json`, `E13.json`: counts, metrics, case outcomes, Wilson intervals, versions,
  base SHA and timestamps; no provider responses or source/user text.
- [Coverage gaps](artifacts/coverage.json) and [index snapshot](artifacts/corpus.json).
- Pre-run leakage checks ran against the current catalog for E3, E11, E12 and E13; all passed.
- Verification: `bun run --filter @lotse/evals test` — **20 files, 103 tests passed**;
  `bun run typecheck` — **8/8 packages passed**; focused changed-source Biome checks passed.

Deviations needed to make the work runnable: exported production retrieval/document extraction
through public brain entrypoints; added the evals workspace dependency on `@lotse/db`; replaced two
stale knowledge ingestion imports of `@lotse/brain/db` with `@lotse/db`; merged duplicate Next.js
`outputFileTracingIncludes` entries while preserving both asset lists. No git write commands ran.
Starting a new Compose project failed because Docker's address pools are exhausted; the already
running configured Postgres service was used successfully. Broader independently reviewed E7 coverage, E4 S3, exhaustive E1 persisted
paths, independent medical/extraction review and human judge calibration were not run.

## E13 first-pass reproduction and verification (historical)

```sh
bun run evals --suite E13 --out /tmp/lotse-e13-detection/summary.json
bun run --filter @lotse/brain test -- test/forms/detect
RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/forms/detect
bun run --filter @lotse/evals test -- test/e13 test/sets/e13
bun run typecheck
```

- [Updated E13 artifact](artifacts/E13-detection.json): exact field counts, case outcomes,
  timestamps, base SHA and unchanged matching criteria. The original
  [E13 baseline artifact](artifacts/E13.json) remains available for comparison.
- Detector tests: **5 files, 44 tests passed**, including the pooled official-form box-recall
  regression, actual symbol-font outlines, all four rotated CropBox cases, existing AcroForms,
  owner continuation and a scan with a searchable footer. Constructed layouts remain test-only.
- Live scan fallback: **1 file, 1 test passed** against real OpenAI.
- E13 harness and gold-loader tests: **2 files, 13 tests passed**.
- `bun run typecheck`: **8/8 packages passed**. Changed-source Biome checks and the detector's
  cognitive-complexity check passed.

Status: **partial**. The requested detector changes are implemented and measured; the full-field
90% recall / 95% precision targets remain unmet. No gold or evaluation scoring was relaxed.
Deviations: a small public knowledge export was added for source-backed detection vocabulary.
No database, protocol, service dependency or secret changed; no git write commands ran.
The broader `bun run --filter @lotse/knowledge e2:scan` was also attempted and failed on existing
catalog-ID references (`rehabilitation`, `care`) in `packages/brain/src/documents/copy.ts:2`;
that file is unchanged by this detector work. This is a separate outstanding release gate.


## E13 second pass — 94.43% recall / 92.21% precision

**Status: partial.** The unchanged informational 90% recall target is met; the 95% precision
target remains unmet. Default production `detectFields` completed **20/20** hash-verified forms,
with **zero execution errors**, **509/539** full-field matches and **509/552** precision.
The first pass was 291/539 recall (53.99%) and 291/586 precision (49.66%). Twelve forms now meet
both per-form targets. No gold, matcher, minimum size or threshold changed. The successful run was
**2026-11-06T03:44:04.845Z–2026-11-06T03:44:07.694Z**, on base revision
`6859462bb239946e4950ddabcc1c024fb6c5492b` plus these uncommitted changes.

There are **521** one-to-one geometric matches (96.66% box recall / 94.38% box precision),
**510** box+label matches and **519** box+owner matches. Thus **18** gold fields lack a matching
rectangle, **12** geometrically matched fields fail a label and/or owner condition, and **31**
predictions have no geometric match. The strict totals are **30 false negatives / 43 false positives**;
a wrong label or owner counts in both. These diagnostic ratios do not replace full-field scoring.

### Error analysis by form and field type

FN/FP below use the unchanged full-field matcher. Different official form layouts, including
repeated tables, boxed identifiers, contextual options and inline dates, remain separate cases.

| Form | Gold | First-pass matches / predictions | Second-pass matches / predictions | FN | FP |
| --- | ---: | ---: | ---: | ---: | ---: |
| svs-000 | 40 | 20/42 | 38/38 | 2 | 0 |
| svs-004 | 39 | 26/35 | 38/41 | 1 | 3 |
| svs-008 | 10 | 8/11 | 10/10 | 0 | 0 |
| svs-009 | 20 | 6/28 | 19/20 | 1 | 1 |
| svs-010 | 18 | 9/18 | 18/18 | 0 | 0 |
| svs-011 | 18 | 16/20 | 18/20 | 0 | 2 |
| svs-012 | 67 | 30/66 | 62/65 | 5 | 3 |
| svs-014 | 19 | 14/19 | 19/19 | 0 | 0 |
| svs-016 | 34 | 23/44 | 33/37 | 1 | 4 |
| svs-017 | 7 | 7/8 | 7/7 | 0 | 0 |
| svs-021 | 44 | 15/41 | 41/44 | 3 | 3 |
| svs-022 | 17 | 13/18 | 15/19 | 2 | 4 |
| svs-027 | 23 | 7/40 | 23/24 | 0 | 1 |
| svs-035 | 18 | 10/23 | 17/22 | 1 | 5 |
| svs-049 | 42 | 18/44 | 33/44 | 9 | 11 |
| svs-053 | 58 | 35/58 | 55/57 | 3 | 2 |
| svs-058 | 11 | 8/11 | 11/11 | 0 | 0 |
| svs-067 | 10 | 5/12 | 8/10 | 2 | 2 |
| svs-125 | 22 | 10/24 | 22/23 | 0 | 1 |
| svs-126 | 22 | 11/24 | 22/23 | 0 | 1 |

| Gold field type | Gold | Full matches | Geometry misses | Box matches with wrong label |
| --- | ---: | ---: | ---: | ---: |
| text | 218 | 205 | 7 | 6 |
| number | 51 | 47 | 2 | 2 |
| date | 95 | 90 | 2 | 2 |
| checkbox | 141 | 135 | 6 | 0 |
| signature | 34 | 32 | 1 | 1 |

The type table groups gold annotations; the harness does **not** score inferred field type.
Predicted-type counts are separate in the error-analysis artifact. In particular, bare `von`/`bis`
labels can still be typed as text even when their boxes, labels and owners match date gold.

The largest remaining case is `svs-049` (33/42 matches; 9 FN, 11 FP): short support/payment labels,
extra bordered writing areas and very small checkbox rectangles remain ambiguous. The sideways
lease schedule improved from 30/67 to 62/67; its rotated page-header answers and one signature box
remain misses. The certificate's long multiline blank and the free-text continuation areas on
`svs-000` remain geometry gaps. Two non-applicant owner disagreements remain. Several legitimate-looking
empty or shaded regions are absent from gold; they remain scored false positives, without relabelling.

### Changes responsible for the improvement

- Join operator fragments and wrapped captions within columns; retain suspended compounds such as
  “Familien- und”, short parenthetical labels, and the closest repeated column caption. Writing
  placeholders are removed from the caption's geometry before association.
- Associate each checkbox with its own option and nearest printed group/question, including
  parallel question columns and repeated document options. Stop wrapping at the next checkbox.
  Source-backed caption/context normalization stays in knowledge data, without template IDs.
- Merge serial/date comb segments with different character widths, recover every square glyph
  in a text run, and carry caption boundaries into adjacent answer rows. Repeated captions split
  unruled shared cells; lettered subcells inherit the corresponding multiline table header.
- Use font-relative heights for inline blanks and preserve writing areas above bottom captions.
  Exclude fill-only shading, dense printed table headers, underlined printed text, and detections
  contained in an already emitted field. These rules reduce duplicate/decorative predictions.
- Evaluate vector fields before deciding on vision. Pages with fewer than two found fields and
  several prompts now use vision when their text is sparse; long instruction continuations do not.
  Merge vision results with the vector/widget findings, preserving their geometry/type and
  reconciling ownership without downgrading a provider-owned field to applicant.

This is evaluation-set-informed tuning, **not held-out validation**. All twenty forms are SVS
publications and gold geometry still lacks independent human adjudication. No production detection
code imports E13 data or receives expected labels, boxes, case IDs or counts.

### Reproduction, evidence and limitations

```sh
bun run evals --suite E13 --out docs/evals/artifacts/e13-second-pass/summary.json
bun run --filter @lotse/brain test -- test/forms/detect
bun run --filter @lotse/evals test -- test/e13 test/sets/e13
bun run typecheck
bun run --filter @lotse/knowledge e2:scan
RUN_LIVE=1 bun run --filter @lotse/brain test:live -- test/forms/detect
```

Artifacts: [E13 result](artifacts/e13-second-pass/E13.json),
[summary](artifacts/e13-second-pass/summary.json),
[coverage](artifacts/e13-second-pass/coverage.json), and
[per-form/type error analysis](artifacts/e13-second-pass/error-analysis.json).
The [first-pass result](artifacts/E13-detection.json) and original baseline remain unchanged.
Artifacts contain counts and safe identifiers, without source text, provider bodies or credentials.

Fresh verification: detector tests **6 files / 55 tests passed**; E13 harness/data tests
**2 files / 13 tests passed**; all offline form tests **11 files / 74 tests passed** with
`bun run --filter @lotse/brain test -- test/forms --maxWorkers=1`; root typecheck
**8/8 packages passed**; E2 generalization scan **passed**; changed-source Biome and detector
cognitive-complexity checks passed. A concurrent forms/evaluation/typecheck run hit four default
5-second test deadlines; the unchanged tests passed with one worker. No test was skipped or
weakened.

The real rasterized-page vision test was **attempted and failed** with `vision_failed`.
A content-free diagnostic confirmed **HTTP 429** from the provider; its response body was not
recorded. No retries were added. An initial E13 attempt also routed two instruction continuations
into this failing provider; the sparse-text guard was corrected and regression-tested before the
final zero-error run. The final set needed no vision call. Unit tests verify sparse-form routing,
retention/deduplication of vector fields, owner reconciliation and exclusion of instruction pages;
**live sparse-page/scan accuracy remains unverified in this pass**. The earlier successful live
check is historical evidence only. Database/MinIO form lifecycle, Mac, and broader application
integration were not run for this detector-only change.

Deviations: expanded the existing public knowledge detection vocabulary/schema and added focused
layout/association helpers and regression tests. No dependency, protocol, database schema,
original challenge file, PRD, orchestration file or secret changed. No git write commands ran.
