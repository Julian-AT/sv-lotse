# @lotse/evals

Evaluation infrastructure for E1–E13. Product suites, gold sets, dashboard UI and CI workflow
integration arrive in later work packages. The CLI initially registers only the arithmetic
self-test under E1; its result is **not** evidence that the product engine passes E1.

Run from the repository root with Node.js 22+ on PATH:

```sh
bun run --filter @lotse/evals typecheck
bun run --filter @lotse/evals test
RUN_LIVE=1 bun run --filter @lotse/evals test:live
bun run --filter @lotse/evals eval run --suite E1 --subset pr --sample 2 --seed baseline --out /tmp/lotse-evals/summary.json
```

From this directory the equivalent CLI entry is
`bun src/cli.ts run --suite E1 --subset pr --out /tmp/lotse-evals/summary.json`.
`test` runs offline unit tests under Vitest/Node. `test:live` makes real OpenAI requests only with
`RUN_LIVE=1`; without it the script reports that live evaluations are disabled and exits zero.
The live launcher loads the repository's `.env.local` with Node's environment parser and preserves
already exported values. It never writes credentials. An explicitly requested live run fails if
credentials are missing or rejected; it does not substitute a model.

## Models and rubric versions

| Environment variable | Default                  | Purpose                                          |
| -------------------- | ------------------------ | ------------------------------------------------ |
| `OPENAI_API_KEY`     | Required for model calls | Direct OpenAI provider credential                |
| `EVAL_JUDGE_MODEL`   | `gpt-4.1-mini`           | Rubric scoring                                   |
| `EVAL_PERSONA_MODEL` | `gpt-4.1-mini`           | Synthetic user's next turn and stopping decision |

Configuration is Zod-validated before provider use. The offline harness needs no provider key.
The OpenAI adapter has the same dependency version range as the brain. Both adapters use AI SDK 7
[`generateText` with `Output.object`](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data),
validate structured output, disable SDK retries, and record the model ID reported by the provider.
Provider failures expose safe error categories without response bodies, request content or causes.

Rubrics in `rubrics/*.yaml` use **the JSON-compatible subset of YAML 1.2**, parsed with `JSON.parse`
and validated with `RubricSchema`. General YAML features (comments, block scalars, aliases) are not
supported. This keeps parsing within the approved dependency budget. Package Biome configuration
preserves this syntax because its YAML formatter adds JSON-incompatible trailing commas; tests
parse and validate both rubric files. Each criterion has a unique
ID, a binary (0–1) or three-point (0–2) scale, and written anchors for every score. The output schema
requires exactly those criteria, their allowed scores and a short rationale. `sample.v1.yaml` tests
arithmetic and simple German; `scenario.v1.yaml` supplies the nine PRD §14 scenario criteria.

Create a new versioned file when anchors change. Bump `JUDGE_PROMPT_VERSION` or
`PERSONA_PROMPT_VERSION` when changing their respective instructions. Judge results include model,
rubric ID, rubric version and prompt version; the runner retains those versions and scores.
Scenario gates remain informational until calibration: 200 human-labelled runs, two raters,
Cohen's kappa ≥ 0.8. Model or judge-prompt changes require recalibration. E5 boundary labels always
need human confirmation. This harness supplies the calculation, not the calibration dataset.

## Register and run a suite

Import the public API from `@lotse/evals`. Register a `RegisteredSuite` with a `suite` definition,
`cases`, and `execute(item, { signal, attempt })`. The adapter returns
`{ passed, metrics, judge? }`. Use `CaseSchema` for external data; gold cases require
`source: { uri, passage }`. Synthetic generators stay in this package. Never put real personal data
in synthetic cases, personas or judge rationales.

`runSuite(definition, options)` requires an explicit `modelVersion` for the system under test and
the current `gitSha`. Set `concurrency` (default 4), `timeoutMs` (60,000 total per case, including
retries), `retries` (2 additional attempts), `subset`, `sample` and `seed` as needed. Adapters must
propagate the abort signal to all I/O and stop when aborted. The runner bounds awaited work and
cannot forcibly stop JavaScript or I/O that ignores cancellation. Throw `TransportError` only for
transient connection, server, rate-limit or transport-timeout failures. OpenAI adapters translate
retryable API failures into this category. Assertion failures, invalid outputs, authentication
failures and expired case deadlines are never retried. Retrying a multi-turn case requires the
adapter to create a fresh system session in `execute`.

Without sampling, cases run in code-point ID order. Sampling ranks the filtered cases by
SHA-256 of `[seed, caseId]`, selects the first n, and retains that order. Case selection and result
order are independent of input order and worker scheduling; model responses and timings are not
deterministic. Subsets match explicit `pr`, `nightly` or `weekly` tags. Tag cases for each intended
schedule: nightly does not implicitly include untagged or PR-tagged cases. Use all suites nightly,
fast E4/E5 subsets alongside E1/E2 per PR, and E10 across model candidates weekly in later CI wiring.

`passRate` is reserved and counts successful cases over **all selected cases**, including errors.
Other case metrics are aggregated as arithmetic means; absent metric coverage produces `null`,
never a mean over only the successful cases. Gates compare the named metric to `threshold`, with
`direction: at_least` (default) or `at_most` (e.g. zero violations). Execution errors fail a gate.
Empty or undersized selected sets yield `insufficient_data`, including deliberately small samples.
Blocking gates must pass to return exit zero; informational failures remain reportable.

`wilson95` describes the binary case success proportion, not an interval around an unrelated mean
metric. `wilsonInterval` also accepts other confidence levels. Empty samples yield `null` for
intervals, proportions and means. Kappa is unweighted and returns `null` when agreement is undefined
(empty samples or constant identical labels). Retrieval helpers deduplicate hits, return `null`
for no relevant items, and use exponential gain `2^relevance - 1` with log2 rank discount for nDCG.
Duplicate retrieved IDs keep their rank positions but earn no extra gain. Grades must be in [0, 30].

## Multi-turn personas

`simulatePersona(spec, system, { maxTurns, timeoutMs, signal })` validates language, age, carrier,
region, goal, known facts and style. `SystemUnderTest` has `startCase()` and
`sendTurn(text): Promise<{ text, events }>`; each optionally receives `{ signal }` for cancellation.
WP-106 can provide a real brain adapter without a protocol change. A simulation ends with
`goal_reached`, `give_up` or `turn_limit` (8 user turns by default). It permits one final model
assessment after the last system reply without sending an extra user turn. The default deadline
is 120 seconds for the entire conversation; errors and timeouts reject rather than claim success.
Returned turns include synthetic text and JSON events. Do not export real user conversations.

## Leakage and results

Call `assertNoLeakage(cases, catalogRecords, thresholdWords)` before using a gold set;
`checkLeakage` returns case/corpus IDs for inspection. Corpus records are `{ id, text }`. The default
threshold is 20 contiguous words, inclusive. Matching normalizes Unicode, case and punctuation and
checks string values in gold inputs and expected slots. Required provenance quotes are excluded;
source attribution does not exempt copied question/slot text. Paraphrases retain their source.

`exportResults(results, out)` writes `<suiteId>.json` next to the summary at `out`, with atomic
replacement per file and private file permissions. The summary includes validated full suite
results and blocking failure IDs. Suite results include counts, metrics, Wilson 95% interval,
gate verdict, seed/subset/sample, model and judge versions, git SHA, timestamps and ordered case
outcomes. Error results contain categories rather than raw exceptions. Reuse `runCli(args, registry,
modelVersion)` from `src/cli.ts` when adding real suites; `--suite all` runs all registered suites.
CLI exit codes: 0 for no blocking failures, 1 for a failed/insufficient blocking gate, 2 for CLI
configuration/execution/export failure. The demonstration is the only default registration.
