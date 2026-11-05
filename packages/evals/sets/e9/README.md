# E9 voice utterance text set, version 1

This is the text-only input to the voice evaluation in PRD §14. The 200 authored,
synthetic Austrian German utterances are reading prompts for later recording or
synthesis. No audio has been produced and no speech recognition, word error rate
or latency result is claimed. The loader validates data, not voice performance.

`cases.json` follows the shared harness `CaseSchema`. Every case has a stable
`e9-NNN` ID, `kind: "synthetic"`, and `synthetic`, `nightly` and `weekly` tags.
The set has no execution adapter or registered runtime gate; those belong to the
later audio evaluation work.

| Tag           | Utterances | Meaning                                                                         |
| ------------- | ---------: | ------------------------------------------------------------------------------- |
| `domain-term` |        150 | Contains at least one annotated domain term                                     |
| `number`      |         40 | Contains a standalone numeric expression, including amounts and digit sequences |
| `date`        |         30 | Contains a spoken calendar date or date range                                   |
| `name`        |         36 | Contains a fictional personal name                                              |
| `dialect`     |         47 | Contains written Austrian colloquial or dialect markers                         |

Tags overlap. The remaining 50 utterances contain no terms from this set's domain
vocabulary and cover ordinary document handling, corrections, accessibility,
dates, numbers and names. Each of the nine required terms occurs in 15 dedicated
utterances; another 15 utterances combine terms. `terms.json` lists the vocabulary:
Rezeptgebühr, e-card, Anschlussheilverfahren, Pflegegeld, Landesstelle, Wahlarzt,
Bewilligung, Heilbehelf and Kostenzuschuss. Each entry has its canonical `term` and
the exact written `forms` accepted in transcript annotations. Version 1 uses only
the canonical forms.

## Transcript and annotation conventions

- `input.utterance` is what the speaker should say; `input.language` is `de-AT`.
- `expected.transcript` is the verbatim written reference. At this text-only stage
  it equals the reading prompt. Keep contractions, self-corrections, fillers,
  diacritics and Austrian words such as Jänner. Do not silently correct dialect
  into standard German. Dialect labels describe the written markers, not a
  verified accent or a claim about a specific Austrian region.
- Numbers are spelled as spoken, including individual digits in identifiers,
  decimal money amounts and corrected amounts. Dates remain spoken words too.
  Punctuation, capitalization and the spelling `e-card` are editorial conventions;
  a future WER adapter must document its normalization separately. Do not use
  identical prompt/reference text as evidence of transcription accuracy.
- `expected.annotations` always contains five arrays: `domainTerms`, `numbers`,
  `dates`, `names` and `dialect`. Each entry is an exact, case-sensitive substring
  of the reference transcript. An empty array means that category is absent.
  Values are distinct surface strings, not occurrence offsets; repeated spoken
  occurrences remain in the full transcript for later scoring.
- `domainTerms` includes every vocabulary form present. `numbers` contains full
  numeric expressions outside dates, with units where spoken. `dates` contains
  the complete date or range without the introductory preposition. Its numeric
  words are not additionally tagged as standalone numbers. `names` contains
  personal names without titles. `dialect` records colloquial markers, including
  reduced pronouns and negation. A nonempty array adds its corresponding tag.
- The text includes realistic requests, short fragments, helper speech, read-back
  corrections and longer administrative questions. Names, dates, amounts, case
  numbers and reported document contents are invented evaluation examples. They
  are neither real personal records nor statements of official fees, eligibility,
  deadlines or medical recommendations.

## Provenance and boundary review

The source for the required vocabulary and coverage is
[the definition source](definition-source.md).
The requirement and medical boundary are in [PRD §§4 and 14](../../../../docs/prd/SV-KI-Lotse-PRD.md).
Vocabulary context is available in the existing knowledge
[synonyms](../../../knowledge/synonyms.yaml) and the source passages already
collected in [E3](../e3/sources.json). The utterances themselves were authored for
this set, rather than copied from catalog text or patient conversations. There
are no fabricated external source quotations.

Author review of the full text kept it administrative: no diagnosis, findings
interpretation, personal risk assessment, therapy choice or medicine/dosage
advice. The Anschlussheilverfahren and Heilbehelf examples ask about documents
and routing, without recommending either. A future recording review must check
that the actual speech matches its reference, especially dialect and names.

## Validation

The loader reads files relative to `import.meta.url`, validates every case with
the shared schema and typed E9 input/expectation schemas, and checks uniqueness,
verbatim references, domain coverage, annotation substrings and tag agreement.
It checks that all categories are represented in at least 20 utterances.

Run from the repository root:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e9
```

The future audio generator is described in [generate-audio.md](generate-audio.md).
