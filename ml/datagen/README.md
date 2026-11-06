# datagen: AT-Benefits v1 dataset pipeline

Shared core for the open dataset `JulianAT/at-benefits` (Hugging Face configs `situations`,
`dialogues`, `documents`, `forms`, `legal_qa`). Labels always come from the product engine (the
research tool server, see `ml/README.md`), never from a language model; models only write surface
text, and every text goes through rule checks, language ID, dedup and a sampled LLM judge.

Run everything from `ml/` with `uv run`.

## Backend and budget

- **Backend.** An OpenAI-compatible endpoint (the owner's local proxy). `config.yaml` `env_file`
  points at a dotenv file with `DATAGEN_OPENAI_BASE_URL`, `DATAGEN_OPENAI_API_KEY` and optional
  `DATAGEN_MODEL_BULK|STRONG|JUDGE` (they override `models`). Read with `dotenv_values`, never
  printed. `DATAGEN_ENV_FILE` overrides the path. Only plain GPT model ids are accepted.
- **Models** (roles): `bulk` = `gpt-6-luna`, `strong` = `gpt-6.1-sol`, `judge` = `gpt-6-sol`.
- **Budget unit: tokens.** The proxy is subscription-backed (no per-token billing), so the cap is
  `tranche_tokens` (tranche 1: 60,000,000 prompt + completion tokens, reasoning included), split
  by `shares` into pools: situations 25 %, dialogues 35 %, documents 20 %, forms_legal_qa 15 %
  (families `forms` and `legal_qa` share it), reserve 5 % (`check`). `pricing.py` holds OpenAI
  list prices (source and date in the file) for an informational USD equivalent; `cap_usd`
  enforces it only when set.
- **Batch API.** `batch_api: auto` probes the backend once (cached in
  `<output_root>/backend.json`). The proxy has none, so `submit_batch` runs the requests as
  concurrent sync calls: at most 4 in flight per family process (the proxy is shared with the live
  app); 429/5xx halve the limit and a 429 pauses all workers for 2 s, 4 s, ... up to 120 s.

## Contract (used by every family)

```python
from datagen.llm import LLM, BudgetExceeded, BatchPending, QuotaError

llm = LLM("dialogues")                 # family name; pool via config `pools`
r = llm.chat(messages, role="bulk"|"strong"|"judge", response_format=None|PydanticModel|schema,
             max_output_tokens=800, temperature=None)
r.text, r.parsed, r.usage, r.cost_usd, r.cached, r.error, r.finish_reason
bid = llm.submit_batch([{"custom_id", "messages", "response_format"?, "max_output_tokens"?}],
                       role="bulk")   # blocks for local batches; returns an id
results = llm.collect_batch(bid)       # list[ChatResult] in submission order (custom_id set)
llm.remaining()                        # {"family": tokens, "total": tokens, "unit": "tokens"}
```

- Before every call the worst case (prompt estimate `chars / chars_per_token` + max output) is
  reserved in the ledger; `BudgetExceeded` if it would cross the pool share or the tranche.
  Actual usage settles it. In local batches each request is reserved separately; once the budget
  refuses, the remaining requests return `error="budget_exceeded"` or `"stopped"`.
- `QuotaError`: the backend refused for key/billing reasons; stop paid work.
- Cache: `<output_root>/cache/<family>/` keyed by the SHA-256 of the request body. Same request
  = free replay; vary the prompt (e.g. include a sample id) to get a new sample.
- `ChatResult.error` is set for refusals, schema parse failures and batch errors; callers drop
  those samples.

| Module | Purpose |
| --- | --- |
| `config.py` / `config.yaml` | Tranche, shares, pools, roles, languages (10 + German variants `de-AT-dialect`, `de-easy`), output root `ml/data/datagen/` (git-ignored, keep < 5 GB) |
| `ledger.py` | SQLite (WAL) ledger `<output_root>/ledger.sqlite`; atomic reservations across processes (`BEGIN IMMEDIATE`); `summary()` per pool/family/model |
| `llm.py` | `LLM` client above; `AdaptiveLimiter` |
| `transport.py` | `OpenAITransport` (proxy) and `FakeTransport` for tests and dry runs |
| `pricing.py` | List prices per model (informational) |
| `models.py` | `python -m datagen.models`: list backend models, validate roles |
| `check_key.py` | `python -m datagen.check_key`: one tiny bulk call; prints `OK …` or `FAIL …`, writes `key_status.json` |
| `quality.py` | `detect_language`/`language_ok` (lingua; BCS = one group), `NearDup`/`dedup` (MinHash LSH, char 5-grams, 0.85), `distinct_n`, `length_stats`, `readability` (Wiener Sachtextformel for German, Flesch otherwise), `judge(items, rubric, llm=…)` with structured scores 1–5 + pass + reason (`judge_requests`/`parse_judgements` for batches), `find_leaks`/`leak_terms`, `wilson` interval |
| `io.py` | Release layout: `write_release_shard(family, split, i, rows)` (zstd Parquet), `write_card`, `write_metrics` (also `ml/results/datagen-<family>-<sha>.json`) |
| `publish.py` | `python -m datagen.publish --family <name> [--version v0.2] [--dry-run]` |

## Release layout and publishing

Each family writes `<output_root>/<family>/release/<split>/*.parquet`, `release/card.md` (its
dataset-card section) and `release/metrics.json`. `datagen.publish` uploads them to
`<family>/<split>/` in the HF repo, merges the card section into the README between
`<!-- family:<name> -->` markers and registers the config in the YAML header (HF_TOKEN from
`.env.local`, never printed). The orchestrator runs the publish command.

## Situations family

See `situations/README.md`: 1,000,000 engine-gold personas (no LLM) and LLM-naturalised situation
texts in 10 languages. `uv run python -m datagen.situations.run --tranche 1`.

## Dialogues family

`dialogues/`: multi-turn, tool-exact pilot dialogues (OpenAI-style messages with `lotse_*` tool
calls and exact research-server outputs, ending in `submit_plan`). Tier O = gym oracle
trajectories as they are; tier A = oracle trajectories whose natural-language turns the bulk
model rewrites (10 languages, Austrian dialect, plain language, injected medical questions handed
off to doctor/1450), re-scored with the gym reward and judged one by one (only passing rows are
released); tier B = strong-model teacher episodes in the gym, kept at R ≥ 0.9 with zero boundary
flags and valid citations. Oracle runs for val/test/heldout_family land in
`<output_root>/dialogues/oracle/`.

```sh
uv run python -m datagen.dialogues.run --tranche 1          # resumable; tier A, then tier B
uv run python -m datagen.dialogues.run --tier none           # rebuild release + metrics only
uv run python -m datagen.dialogues.run --fake --limit-a 20   # offline smoke run
```

## Tests

`uv run pytest datagen` (fake transport: budget enforcement, cache, batch round trip, local batch
fallback, ledger concurrency across processes, quality helpers, README merge).
