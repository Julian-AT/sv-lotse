# situations family

Config `situations` of `JulianAT/at-benefits`.

1. **Personas (no LLM).** `python -m datagen.situations.personas --workers 4` samples 1,000,000
   personas with the v0.1 generator (`personas.generate`: split fixed by index first, area D held
   out in `heldout_family`, resampling across the family boundary, held-out styles only in test)
   from a new seed (`SEED = 202611071`; v0.1 used 20261106) and labels each with `POST /gold`
   (48 concurrent requests per worker). 50 shards of 20,000 under
   `<output_root>/situations/personas/` (zstd Parquet); existing shards are skipped.
2. **Naturalisation (LLM, budgeted).** `naturalize.py`: a deterministic queue (hash order, split
   quotas train 80 / val 7 / test 7 / heldout 6 %) is processed in chunks of 100. Each persona
   gets a language/variant from `config.yaml` `languages` (hash of the id; German has standard,
   Austrian dialect by federal state, and plain language B1; BCS picks Bosnian, Croatian or
   Serbian), the bulk model rewrites the template text from the card (prompt in `prompts.py`:
   only card facts, no benefit/office names, register/literacy/noise, style), then:
   - rule checks on every text: lingua language ID, no gold or bundle benefit names or ids,
     numbers only from the card (ages ±2 for self-corrections, income bounds, small counts), no
     contact data, 8–220 words;
   - the engine re-labels with the new text and card language (`min_questions` reads the opening
     text), so gold stays engine-computed;
   - an 8 % hash sample is judged by the judge model (faithful, no_leakage, language, register,
     natural, concern; pass needs faithful and no_leakage ≥ 4, the rest ≥ 3); failing rows drop;
   - MinHash near-duplicates are dropped.
   Chunks land in `<output_root>/situations/natural/chunk-NNNNN.parquet` with all quality fields
   (rejected rows included, with `reject_reason`). A chunk interrupted by the budget is not
   written and is redone on resume (the response cache makes the redo free).
3. **Release.** `release.py` writes `release/<split>/` (train, validation, test, heldout_family)
   with all 1M personas: `text_source` = `llm` rows carry the accepted rewrite, the others the
   template text; plus `card.md`, `metrics.json` (counts, languages, acceptance, reject reasons,
   judge pass rate with Wilson interval and criterion means, distinct-n, length and readability
   per variant, leakage test on a 3 % template sample and on the LLM rows, ledger summary) and
   `spotcheck.jsonl` (stratified sample: up to 6 per variant × split, with empty review fields).
   Metrics are also written to `ml/results/datagen-situations-<sha>.json`.

Runner (resumable; stops at the situations token share; paid steps only after check_key OK):

```sh
uv run python -m datagen.situations.run --tranche 1                    # all steps
uv run python -m datagen.situations.run --steps natural --max-chunks 2  # a small paid run
uv run python -m datagen.situations.run --steps release
uv run python -m datagen.publish --family situations                    # orchestrator
```
