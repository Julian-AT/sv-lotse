# Lotse-RL research lane

Python 3.12 workspace managed with `uv`. The plan is in [docs/research/lotse-rl.md](../docs/research/lotse-rl.md).

```sh
cd ml
uv sync
uv run pytest
```

Results of every run are written to `results/` as JSON with configuration, data hashes and the git SHA.

## Training (R2/R3 lane)

Training dependencies are the optional `train` extra (`uv sync --extra train`, GPU box only); verl
for GRPO is installed separately on the GPU box (`uv pip install "verl[vllm]"`).

| Command (from `ml/`) | Purpose |
| --- | --- |
| `uv run python -m sft.rollout --teacher <model> --n 120000` | Teacher rollouts in the gym, kept if R ≥ 0.9, zero boundary flags, valid citations |
| `uv run --extra train python -m sft.train --base qwen3-30b-a3b` | SFT (configs in `sft/configs/`: `qwen3-30b-a3b` LoRA r=64, `eurollm-9b` full, `qwen3-8b` LoRA, `qwen3-1.7b-smoke`) |
| `uv run --extra train python -m sft.smoke --config sft/configs/qwen3-8b-smoke.yaml` | Short LoRA SFT plus plan proxy eval of base and fine-tune |
| `uv run --extra train python -m eval.plan_eval --model <hf id> [--adapter <dir>]` | Single-turn plan **proxy** eval (no tools, no simulated user); not the multi-turn gym |
| `uv run python -m rl.prepare` then `uv run python -m rl.train --config rl/grpo-a3b.yaml` | Multi-turn GRPO with verl (`rl/grpo-a3b.yaml`, `rl/grpo-euro9b.yaml`); reward from `gym.reward` via `rl/reward_plugin.py` |

SFT trains on the gym's oracle trajectories (`data/sft/oracle.jsonl`) when present, otherwise on
single-turn plan examples derived from the personas' gold. Loss is on assistant and tool-call
tokens only (`sft/masking.py`).

## Research tool server

`packages/brain/src/research/server.ts` serves the real brain tools and the engine's ground truth to
the gym. It is research-only: not exported from `@lotse/brain`, never imported by `apps/*`, and it
never calls a model provider.

```sh
# once: own database (never the shared `lotse` one), schema and catalog (no embeddings needed)
createdb -h 127.0.0.1 -U lotse lotse_research          # or: docker exec <postgres> createdb -U lotse lotse_research
export DATABASE_URL=postgres://lotse:lotse@127.0.0.1:5432/lotse_research
(cd packages/db && bun run db:migrate) && (cd packages/knowledge && bun run catalog:load)
# serve (127.0.0.1, PORT defaults to 4317)
DATABASE_URL=$DATABASE_URL bun packages/brain/src/research/server.ts
```

Env: `DATABASE_URL` (required), `PORT` (default 4317). Tests (five hand-checked gold personas plus
the tool flow): `DATABASE_URL=… bunx vitest run test/research` in `packages/brain` (skipped without
`DATABASE_URL`).

| Endpoint | Contract |
| --- | --- |
| `GET /health` | `{ok, benefits, processes, offices, defaultCase: {caseId, subjectId}}` |
| `GET /catalog/summary` | `benefits[]` (id, names, area, scope, life_situations, process, criteria, documents, target_group), `life_situations[]`, `goals[]` (process id, benefit, life_situations, entry_slots), `offices.count`, `vocabulary` (carriers, statuses, pension_carriers, states, regions, districts per state, sex, needs, documents, goals, persona_fields) |
| `GET /tools` | Every tool contract with JSON Schema input and `available` |
| `POST /reload` | Re-read the catalog from the database after `bun run catalog:load` (the catalog on `main` changes often; gold always reflects the loaded catalog) |
| `POST /episodes` | Optional `{confirmedGoal?, lifeSituation?}` → `201 {caseId, subjectId}`: a fresh research subject and case with a running turn. Send `X-Research-Case: <caseId>` on tool calls to use it; without the header the server's default case is used |
| `POST /tools/<name>` | Body is the tool's exact Zod input; the response is its exact output. `400 {error:"invalid_input", issues}` on validation errors, `404 unknown_tool`, `422 {error:<domain code>, message}` for product errors (e.g. `OFFICE_CONTEXT_REQUIRED`, `GOAL_CONFIRMATION_REQUIRED`), `403 permission_denied` for approval tools (cases run at L1), `501` for client tools and model tools (`kb.search`, `docs.extractStatements`, `docs.explainLetter`, `reminder.extract`, `form.analyze`, `form.getSchema`: "model tool not available in research server") |
| `POST /gold` | `{persona}` (plan §5.2 schema, plus optional `life_situation` and `opening_facts`) → `{benefits, offices, documents, min_questions, citations}` and diagnostics (`warnings` for persona values outside the vocabulary, `process`, `life_situation`, `offices_unresolved`, `documents_status`, `criteria_status`, `excluded`, `question_slots`, `facts`). `400` for an invalid persona or unknown goal |

The process tools follow the product flow: `case.update` with `patch.confirmedGoal`, then
`process.start {caseId, benefitId}`, `process.nextStep`, `process.applyAnswers`.

Gold definitions (all computed by product code, never a model):

- **Facts.** The household member with `role: "subject"` is mapped to engine facts by the table in
  `vocabulary.persona_fields` (`residence.state` → `residence_region`, `federal_state`, `region`, …
  and `domestic_residence` when the state is Austrian; `insurance.carrier` → `insurance_carrier`
  (lower case); `insurance.pension_carrier` → `pension_source` via `knowledge/data/office-context.json`;
  `age`, `sex` (f/m/d), `care.pflegegeld_level` → `care_level`, non-empty `children` →
  `child_born`). Fields not listed (needs, employment, income, language, helpers) do not change gold.
- **Goal.** `goal` is a process id (or benefit id) from `goals[]`. The bundle is the product's
  `catalog.findBenefits` bundle for `life_situation` (default: the goal benefit's first life
  situation).
- **Benefits.** Bundle members whose criteria, evaluated by the engine's condition evaluator (plus
  age/sex target groups), have no `not_met`. **Unknown counts as eligible**: missing data never
  becomes a negative claim (engine rule); `criteria_status` shows which are unknown.
- **Offices.** `office.resolve` logic (office rules with carrier, region, status `pensioner:<pension
  carrier>` and the facts). Ambiguous or missing context leaves the benefit in `offices_unresolved`.
- **Documents.** Catalog documents with `required: true` (`documents.checklist` status `have` or
  `missing`); `documents_status` uses `documents_held` like the checklist does.
- **min_questions.** Number of slots the engine reports missing for the goal's process at its entry
  step (`process.nextStep.missingSlots` right after `process.start`), given only what the opening
  statement provides: persona fields listed in `opening_facts` plus slot enum values named verbatim
  in `situation_text`.
- **Citations.** Every criterion of a kept benefit with status `met` or `unknown`, with its source
  URL, quote and `legalBasis` where the catalog has one.

## Quantum experiments (§9, T9)

```sh
uv sync --extra quantum
uv run python -m quantum.run --backend aer          # instances, CP-SAT/ILP/greedy/SA, QAOA on Aer
uv run python -m quantum.run --backend least_busy --env-file ../.env.local   # IBM Heron, p=1
uv run pytest quantum
```

Instances are built from `packages/knowledge` (catalog, processes, offices, postcode centroids)
and hashed; modelling choices and penalty weights are documented in `quantum/instances.py` and
`quantum/qubo.py` and copied into `quantum/results.json`. No quantum-advantage claim is made.


## Personas

`personas/` generates the AT-Benefits personas (card, situation text, engine gold) and validates
them; the dataset card is [personas/README.md](personas/README.md).

```sh
uv run python -m personas.generate --n 55000 --out data/personas   # needs the research tool server
uv run python -m personas.validate --data data/personas --leakage  # writes results/personas-<sha>.json
uv run --extra publish python -m publish.personas                  # owner: uploads to HF
```
