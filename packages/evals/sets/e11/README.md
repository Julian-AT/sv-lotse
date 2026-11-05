# E11 slot extraction gold set, v1

All 300 utterances and their speakers are **synthetic**, authored only for evaluation.
They are gold annotations (`kind: gold`, `synthetic` tag), not real user records.
The set contains 245 single-slot examples and 55 mixed-context examples.
The first 270 items form nine thematic blocks of 30; the carrier block includes
25 mixed-context items that also explicitly establish insurance coverage.
It covers Austrian colloquial German, simple German, English, Turkish,
Bosnian and Ukrainian. Simple German is an editorial label for short, direct
sentences, not a certification of Leichte Sprache. No model extraction accuracy
has been measured by the loader test.

## Loading and scoring

`cases.json` is an array of WP-111 `CaseSchema` items; `suite.json` follows
`SuiteSchema`. Input is `{ utterance, language, register }`; expected output is
`{ slots: { slot_name: normalized_value } }`. Only the utterance is extraction
content; language/register are evaluation metadata. All applicable stated facts
must be extracted; missing or ambiguous facts are omitted, never guessed. An
extra slot is an error. Corrections in the same utterance supersede earlier facts.

The speaker is the subject unless they explicitly say they are helping someone
else: then the facts refer to that person, except `helper_relation`, which always
describes the speaker relative to the subject. Do not transfer the helper’s own
facts to the subject. Personal amounts exclude a partner’s or household income.
The suite records an informational 0.95 target for `slotAccuracy`; a future runner
should average exact normalized slot-map matches across all 300 cases, counting
missing and extra slots as failures. Both nightly and weekly select the full set.

Run from the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e11
```

## Slot definitions

WP-101 process schemas and process records are absent in this checkout. The
brief explicitly permits descriptive names for processes that do not exist yet.
These versioned definitions are provisional evaluation vocabulary, not changes
to the product protocol, database or catalog. Reconcile them with real process
slot names before wiring this set into a process extractor. The list of slot types
comes from `orchestration/wp/W1/WP-164-e11-slot-extraction-gold-sets.md`, Goal;
PRD §10 provides carrier, region, age-band, administrative-date and subject
context and §14 E11 specifies multilingual structured slot extraction. Neither
source specifies income/age partitions or enum spellings; those conventions are
explicitly defined here rather than attributed to official eligibility rules.

Each case’s `source` quotes the applicable definitions below. The machine-readable
mirror in `slot-definitions.json` links to the verbatim brief passage requiring
slot-definition provenance. `file:///repo/` is a portable repository-root URI
namespace, resolved by the loader test; it does not refer to a host’s `/repo`
directory. These authored administrative definitions are the primary source for
these synthetic gold values. No external legal or clinical claims are made.

insurance_status: insured means explicitly insured without a stated subtype; uninsured means explicitly not insured; co_insured means explicitly covered through another person; self_insured means explicitly voluntarily self-insured. Employment alone does not establish insurance status.

carrier: normalize explicit health insurer names to OEGK (ÖGK, Österreichische Gesundheitskasse, former Gebietskrankenkasse/GKK), SVS (Sozialversicherung der Selbständigen), or BVAEB (Versicherungsanstalt öffentlich Bediensteter, Eisenbahnen und Bergbau). Do not infer a carrier from employment.

federal_state: normalize the stated Austrian state of residence to Burgenland, Kaernten, Niederoesterreich, Oberoesterreich, Salzburg, Steiermark, Tirol, Vorarlberg, or Wien. An explicitly stated city of residence may identify its state; workplace and travel destinations do not.

age_band: map explicitly stated completed years to under_18 (0–17), 18_to_39 (18–39), 40_to_44 (40–44), 45_to_74 (45–74), or 75_plus (75 and above). These are evaluation partitions, not eligibility rules. Do not infer age from school, work or retirement.

care_need: help_reported means the subject explicitly reports needing help with daily activities; no_help_reported means the subject explicitly reports managing daily activities without help. Do not infer a care level, diagnosis or entitlement.

hospital_discharge_date: the explicitly stated actual date of leaving hospital, normalized to YYYY-MM-DD. Admission, planned discharge and dates belonging to another person are excluded. Relative dates require input.reference_date; without it omit the slot.

helper_relation: the speaker’s relationship to the subject, normalized to self, child, parent, partner, sibling, grandchild, friend, or neighbor. A daughter helping her mother is child; a mother helping her daughter is parent. Gender is not encoded.

income_band: explicitly stated monthly net personal income in EUR maps to no_income (0), under_1000 (greater than 0 and below 1000), 1000_to_under_2000 (1000 inclusive to 2000 exclusive), or 2000_plus (2000 and above). These synthetic evaluation bands are not benefit thresholds. Omit gross, household, annual or unspecified-period amounts.

child_birth_date: the explicitly stated actual birth date of the subject’s child, normalized to YYYY-MM-DD. A due date, another person’s birth date and a date without a year do not establish this slot.

## Coverage and medical boundary

Each thematic block has 18 colloquial German, six simple German, three English,
and one each Turkish, Bosnian and Ukrainian items. The final 30 cases add 18
colloquial German, four simple German, four English, two Turkish, one Bosnian and
one Ukrainian items: totals are 180 colloquial German, 58 simple German, 31
English, 11 Turkish, 10 Bosnian and 10 Ukrainian. Thus 120 utterances are
non-German or simple German (counting each utterance once).

Cases include explicit negation, corrections, decimal amounts, income and age
boundaries, all nine federal states, Austrian insurer names, dates in words,
leap days, admission versus discharge, due dates versus actual birth dates,
helper relationship direction, and omitted uncertain insurance, gross/household
income, planned dates and unanchored relative dates. No date depends on the test
execution date. Insurance status appears in 71 gold maps, including personal
insurer affiliations and explicit confirmations of coverage. Merely naming an
institution on a letter does not establish current insurance coverage.
Single-slot cases intentionally assert no unstated facts.

The utterances and gold values were reviewed for PRD §4: they contain only
self-reported administrative facts and everyday assistance descriptions. Care
need is not a clinical assessment or a Pflegegeld level. Expected output is a
closed vocabulary of administrative values and ISO dates, never advice,
diagnosis, interpretation, health risk or treatment recommendations. The test
adds a vocabulary regression guard; it is not a substitute for editorial review.

The loader runs the harness `assertNoLeakage` against every existing catalog
YAML/JSON file, recursively. There are no catalog records in this checkout, so
that comparison currently has an empty corpus; it will include records when
present. Raw file text is used so provenance and other catalog strings are also
checked. No catalog examples or service doubles are fabricated.
