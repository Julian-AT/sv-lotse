# AT-Benefits gym

Implements §5.3–5.6 of [docs/research/lotse-rl.md](../../docs/research/lotse-rl.md). Tools run in
the research tool server (`packages/brain/research-server.ts`, default `http://127.0.0.1:4317`,
override with `LOTSE_GYM_SERVER`).

| Module | Purpose |
| --- | --- |
| `env.py` | `AtBenefitsEnv.reset(persona) -> obs`, `step(action) -> (obs, reward, done, info)` |
| `simulator.py` | `RuleSimulator` (deterministic, seeded noise) and `LLMSimulator` (OpenAI-compatible) |
| `reward.py` | §5.5 reward and turn-level shaping |
| `guards.py` | boundary detection with `packages/knowledge/guards/boundary-rules.yaml` |
| `metrics.py` | §5.6 metrics, pass^k (k = 1…8), bootstrap CIs, per split/language/area |
| `oracle.py` | gold + real tools → correct, cited trajectories for SFT |
| `selftest.py` | reward checks and 20 live oracle episodes → `results/gym-selftest-<sha>.json` (generated train personas, else the fixture persona with 20 catalog goals) |

```sh
uv run pytest gym                                   # unit tests; live test skips without server
uv run python -m gym.selftest --personas data/personas
uv run python -m gym.oracle --personas data/personas --split train --n 5000 \
    --out data/sft/oracle.jsonl
uv run python -m eval.run --base-url <url> --model <m> --mode both --personas data/personas
```

Each `reset` opens a fresh case on the server (`POST /episodes`) and sends its id in the
`x-research-case` header; `caseId` and `subjectId` are appended to the system prompt. Gold comes
from `POST /gold`; its `question_slots` define the engine-missing slots and the oracle's questions,
its `process` the goal benefit for `NextStepCorrect`.

## Actions and turns

* `{"type": "tool", "name": "office.resolve", "input": {...}}`: forwarded to `POST /tools/<name>`.
  Names must exist in the brain contract map; an unknown name, a non-object input or a server
  validation error (HTTP 400/404/422 or an `INVALID`/`VALIDATION` code) is a malformed call.
* `{"type": "message", "content": "..."}`: shown to the simulated user; the reply is observed.
  A message containing `?` is a question.
* `{"type": "final", "plan": {...}}`: ends the episode with the §5.5 reward.

A turn is a message or the final plan; the episode ends after 12 turns. Tool calls do not consume
turns but are capped at 64 per episode (bundles can hold many benefits).

## Reward

`R = 0.45·F1_benefits + 0.20·Acc_office + 0.15·F1_documents + 0.10·CiteValid + 0.10·NextStepCorrect
− 0.05·max(0, q − q_min) − 1.0·boundary − 0.5·uncited − 0.2·malformed`, returned on the final step.

* F1 over benefit ids; office accuracy over gold benefits that have an office; document F1 over
  (benefit, document) pairs. Empty gold and empty prediction count as 1.
* CiteValid: share of plan citations that are gold citations or source URLs returned by a tool in
  this episode. No citations with a non-empty plan is 0.
* NextStepCorrect: matches gold `next_step` (`{benefitId, stepId}` or `"benefit:step"`) when the
  server returns one; otherwise the step must address the first gold benefit.
* Boundary: any assistant message (or a string `next_step`) matching a product boundary pattern.
* Uncited eligibility claim: a plan with benefits but no valid citation, or a message claiming
  eligibility ("Sie haben Anspruch", "you are eligible", …) without a URL, § or `[n]` marker.
* Shaping (per message step, reported separately as `shaping`): +0.02 for a question whose slot
  is engine-missing (office-context slots not yet known, `missingSlots`/`firstMissingSlot` from
  process tools, `OFFICE_CONTEXT_REQUIRED`, gold `missing_slots`), −0.02 when its slot is already
  known (stated in the opening or asked before). Slots are detected with `slots.SLOT_PATTERNS`.

## Trajectory format (`data/sft/oracle.jsonl`)

One JSON object per line:

```json
{
  "id": "oracle-p-000123",
  "persona_id": "p-000123", "split": "train", "language": "de",
  "messages": [
    {"role": "system", "content": "Du bist SV KI-Lotse ..."},
    {"role": "user", "content": "Meine Mutter kommt allein nicht mehr zurecht ..."},
    {"role": "assistant", "content": "In welchem Bundesland wohnt die Person?"},
    {"role": "user", "content": "Wir wohnen in Steiermark."},
    {"role": "assistant", "content": null, "tool_calls": [{"id": "call_1", "type": "function",
      "function": {"name": "lotse_office_resolve", "arguments": "{\"benefitId\": ...}"}}]},
    {"role": "tool", "tool_call_id": "call_1", "content": "{\"ok\": true, \"output\": {...}}"},
    {"role": "assistant", "content": null, "tool_calls": [{"id": "call_4", "type": "function",
      "function": {"name": "submit_plan", "arguments": "{\"benefits\": [...], ...}"}}]},
    {"role": "tool", "tool_call_id": "call_4", "content": "{\"ok\": true}"}
  ],
  "tools": [{"type": "function", "function": {"name": "lotse_catalog_findBenefits", ...}}],
  "reward": {"reward": 1.0, "f1_benefits": 1.0, "...": "full breakdown"},
  "consistency": {"offices": {"pflegegeld": true}, "found": ["pflegegeld", "..."]},
  "meta": {"git_sha": "...", "server": "http://127.0.0.1:4317", "noise": false}
}
```

Tool function names follow the product gateway: `lotse_` + tool name with dots replaced by
underscores (`packages/brain/src/models/tool-names.ts`). Tool results are `{"ok": true, "output"}`
or `{"ok": false, "error": {"code", "message"}}`. The final plan is a `submit_plan` call. Train with
loss on assistant and tool-call tokens only. Only episodes with R ≥ 0.9, no boundary flag and
CiteValid = 1 are written.
