# E12 extraction gold, version 1

`gold.json` contains the WP-111 `SuiteSchema` and 15 `CaseSchema` records:
5 SV-Box PDFs and 10 original synthetic German documents (6 discharge letters,
4 reports). There are 125 annotations. This is annotation data, not a model run
or a measured precision/recall result. The precision gate retains the PRD §14
minimum of 30 documents, so this initial set cannot pass the release gate alone.

## Sources and text positions

Original documents are resolved relative to `SVBOX_DIR`, defaulting to the
repository's `data/svbox`. They are never copied or modified. A relative
`SVBOX_DIR` is resolved from the repository root, independently of the working
directory. An absolute `SVBOX_DIR` is used unchanged. Each original
records its SHA-256 and page count; `svbox:///Befunde/...` URIs identify portable
SV-Box paths rather than a developer's filesystem. Synthetic texts are stored
in `input.document.pages`, labelled SYNTHETISCH on every page, and contain only
invented case references and explicitly fictional institutions, with no persons.
Their provenance URI is `synthetic:///e12/<case id>`.

Every expected annotation has a stable ID, fact type, verbatim quote, one-based
page, and page-local half-open `[start, end)` text offsets measured in JavaScript
UTF-16 code units. Original offsets address the unmodified output of:

```sh
pdftotext -layout -enc UTF-8 "$SVBOX_DIR/Befunde/<filename>.pdf" -
```

Split output on form feed (`\f`) and discard only the empty final element.
Do not trim pages, normalize spaces, join lines, or normalize Unicode. Synthetic
offsets use the same convention directly on the stored page strings. Quotes
retain table columns and line breaks even when PDF text order is awkward.
A source passage on each case is its first annotated quote; every annotation
inherits that case's document URI. No paraphrased value is supplied.

## Annotation policy and coverage

Only documented navigation recommendations and administrative facts are gold.
The discharge letter covers its issuing department, insurer, discharge date,
follow-up arrangements, four named medicines without their purpose or advice,
rehabilitation recommendation with its timing qualifier, application preparation,
insurance and cost hints, and the open-task table including its responsibilities.
Imaging reports contribute only institution, document/visit dates and case
numbers. FZ and Fallzahl are retained separately even where they disagree.

The vaccination pass has all nine entries across both pages. Each entry is one
`vaccination_record`, preserving the associated product, date, dose, batch and
location together, including the two vaccinations on the same day. No vaccination
recommendation or inferred schedule is added. Conflicting identity headers are
excluded rather than reconciled; demographics are outside this set's fact scope.

Synthetic letters and reports vary prose, lists, aligned fields, task tables,
continuation pages, appointment cancellations, pending applications and uncertain
insurance responsibility. Clinical sentences are input distractors only.

Manual source review excludes diagnoses, findings, clinical assessments,
therapeutic instructions, risk statements, rehabilitation rationale and goals.
Verbatim clinical findings are **not** gold simply because they occur in a source.
Explicit documented care-navigation recommendations retain their qualifiers;
no eligibility, clinical necessity or approval is inferred. The `exclusions` list
records representative clinical spans (plus the conflicting vaccination header)
for negative overlap checks. It is not an exhaustive clinical classifier.

## Validation

Run from the repository root (requires Poppler's `pdftotext` on PATH and the
original SV-Box files; missing sources fail rather than skip):

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test -- test/sets/e12
```

The loader tests validate the harness schemas, exact document inventory, synthetic
labels, annotation shapes/count, source hashes, every quote/page/offset, all nine
vaccination entries, and exclusion spans with no overlapping gold. The leakage
check discovers every existing YAML/JSON file recursively in
`packages/knowledge/catalog` and checks its text with `assertNoLeakage`. This
checkout has no catalog records yet; an absent catalog is an empty corpus, not
fabricated records. The test will include catalog files when they are added.
