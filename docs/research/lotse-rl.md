# SV KI-Lotse — Research Plan

Complete, self-contained plan for the research lane on top of the SV KI-Lotse product (see the technical PRD). It covers data, the AT-Benefits gym, the model family, training on 3×H100, evaluation, the quantum experiments, the repository layout, the arXiv paper and the gates. Compute figures and hyperparameters are starting points for planning, not measured values. Every external model, dataset and paper named here was checked to exist; links are in the Sources section.

## 1. Summary

**Lotse-RL: training grounded benefits-navigation agents with executable eligibility rules for Austrian social insurance.**

The product's process engine and catalog encode eligibility as code. For any simulated person, the correct benefits, responsible office, required documents and minimal question set can be computed exactly. That makes rewards verifiable, the setting where multi-turn reinforcement learning (GRPO) works best. We build a gym from the real brain tools (AT-Benefits), train two open agent models in it with the identical pipeline (SV-Lotse-A3B on Qwen3-30B-A3B, SV-Lotse-Euro-9B on EuroLLM-9B), add four supporting models (Guard, Einfach, Embed/Rerank, Point), run two quantum optimization studies on IBM hardware from real catalog instances, and publish everything on Hugging Face with an arXiv preprint.

| Decision | Choice |
| --- | --- |
| Compute | 3×H100 80 GB |
| Agent bases | Qwen3-30B-A3B and EuroLLM-9B as co-primary, identical pipeline, head-to-head comparison; Qwen3-8B as dense control |
| Human study | None (hackathon scope); stated in limitations |
| Release | Julian's personal Hugging Face profile |
| Paper | arXiv preprint (cs.CL / cs.AI), tables generated from result files |
| Quantum | IBM Quantum hardware via Qiskit Runtime; research appendix, no advantage claim |

## 2. Prior work: Medlyn

[Medlyn](https://github.com/Julian-AT/medlyn) (IBM Austria hackathon, Track 1) is our earlier proof of concept for the same research pattern: source-linked German clinical facts, a 100,000-patient synthetic German corpus, a Qwen3-1.7B QLoRA claim verifier in MLX with a local→GPT cascade, a Qiskit kernel/QAOA lane run on `ibm_marrakesh`, and a LaTeX paper generated from result files. It demonstrates the idea end to end; the implementation was hackathon-grade. Lessons and fixes:

| Medlyn observation | Consequence here |
| --- | --- |
| Local verifier 0.764 macro-F1 on synthetic held-out vs 0.421 on real text | Real-text test sets from the start; synthetic and real populations always reported separately; labels computed by rules, not guessed by an LLM; RL against executable rules |
| Full-data run hit a 45-minute wall cap before one epoch | Every reported model is a completed, logged run on 3×H100 |
| Quantum lane used character-hash features after an API quota failure; no link to a task | Quantum instances come from real catalog data (scheduling, set cover), with classical baselines shipped in the product |
| 1.7B model on a Mac | MoE 30B-A3B and dense 8–9B bases; 1.7B kept as on-device control for the Guard |

Reused from Medlyn: seeded generator design (split before rendering, held-out styles), cascade pattern, `uv`-managed `ml/` lane, paper pipeline (tectonic, numbers extracted from result files), results with hashes.

## 3. Contributions (paper claims)

1. **AT-Benefits**, an interactive benchmark and RL gym for Austrian social benefits with executable ground truth, built on the product's real tools; released on Hugging Face.
2. **SV-Lotse-A3B and SV-Lotse-Euro-9B**, two open agent models trained with SFT → multi-turn GRPO → DPO in that gym; each improves over its base and is compared with frontier API models on benefit F1, office accuracy, excess questions and pass^k, with zero boundary violations on the red-team set. A head-to-head comparison isolates the base model.
3. **Engine vs free-form**: the deterministic engine with a trained open model beats free-form frontier reasoning; process definitions synthesized from law text recover most of the gain without hand authoring.
4. **Supporting models** with public benchmark numbers: Guard (boundary and attribution), Einfach (B1 plain language), Embed/Rerank (Austrian legal retrieval), Point (GUI grounding on Austrian portals).
5. **Quantum appendix**: case scheduling and document set cover as QUBOs from real catalog instances; QAOA on IBM hardware vs CP-SAT and simulated annealing.

## 4. Data

### 4.1 Do we need synthetic data?

Partly. No public Austrian benefit-counselling dialogues exist (privacy), so agent training data is synthetic. Everything else uses real data or real data with automatically derived labels. The synthetic labels are not LLM guesses: they are computed by the same rules the product runs, so a label is wrong only if a rule is wrong. Volume is not the bottleneck (the gym generates episodes without limit); diversity and real-text evaluation are.

| Part | Source | Real / synthetic |
| --- | --- | --- |
| Domain pretraining (CPT) | RIS federal law (OGD API), SozDok, German Commons Legal + Political (~6.5B tokens) | Real |
| Agent SFT | ~100k teacher trajectories in the gym, kept only if the rules score them correct, boundary-clean and cited | Synthetic, rule-labelled |
| Agent GRPO | Personas sampled per episode; reward from rules | Generated on the fly |
| Guard | Synthetic violations of the six brief prohibitions + AttributionBench | Mixed |
| Einfach | German4All (25k, GPT-4-synthesized), DEplain-APA (human, Austrian, research licence), synthetic administrative paraphrases | Mixed |
| Embed/Rerank | GerDaLIR (123k real queries) + synthetic Austrian queries from RIS paragraphs | Mixed |
| Point | Real screenshots of Austrian portals and forms; labels from DOM / accessibility tree | Real images, automatic labels |
| Evaluation | Hand-written utterances, SV-Box sample documents, CARDIO:DE letters | Always real, reported separately |

### 4.2 Sources

| Source | Content | Size / licence / access | Used for |
| --- | --- | --- | --- |
| RIS OGD API v2.6 (`data.bka.gv.at/ris/api/v2.6`) | Consolidated Austrian federal law, one document per § or article, daily, JSON index, XML/HTML content | Public, no registration | CPT corpus, retrieval corpus, process synthesis inputs, citations |
| SozDok (SV-Box, sozdok.at) | Social-insurance law with annotations | SV-Box | Same |
| oesterreich.gv.at, carrier sites | Procedures, offices, forms | Public pages | Catalog only (not model training) |
| German Commons (`coral-nlp/german-commons`) | 154B tokens openly licensed German; Legal 2.99B, Political 3.57B | CC-BY-SA 4.0 or more permissive | CPT background |
| GerDaLIR (`mteb/GerDaLIR`, lavis-nlp) | German legal IR: 3.1M passages, 123k queries, qrels | MIT | Embed/Rerank training; MTEB `GerDaLIRSmall` eval |
| German4All (arXiv 2508.17973) | 25k paragraph paraphrases at 5 readability levels | Open | Einfach SFT |
| DEplain-APA (zenodo 7674560) | Austrian Press Agency, standard → B1 / A2, 483 docs, sentence-aligned | Non-commercial research, on request | Einfach eval and research-only training split |
| DEplain-web, EasyGerman (KONVENS 2025) | Parallel plain-language German | Open / on request | Einfach eval |
| AttributionBench (`osunlp/AttributionBench`) | Claim–evidence attribution | Open | Guard (attribution head) |
| CARDIO:DE (Sci Data 2023) | 500 de-identified German doctor's letters, medication and section annotations | Distributable under DUA | Real-text test for statement extraction and Guard |
| GGPONC | German oncology guideline corpus | Free | Red-team generation material |
| XFUND de | German forms with key-value annotations | Open | Point and form-field understanding |
| ScreenSpot-Pro (arXiv 2504.07981), ScreenSpot-v2 | GUI grounding benchmark | Open | Point eval / training mix |
| FormFactory (arXiv 2506.01520), FormGym (arXiv 2506.14079) | Form-filling agent benchmarks | Open | Point and fill eval |
| BeNYfits (arXiv 2502.19610) | Interactive benefit eligibility benchmark (NYC) | Open | Method template, cross-domain reference |
| Common Voice de (accent = Austria), MedASR-DE-AT | Austrian-accent speech | CC-0 / thesis | Optional STT eval appendix |
| SV-Box (challenge) | EKO, anonymized ELGA findings, SozDok, fee schedules, sample forms | Challenge terms | Catalog, extraction gold, demo |

### 4.3 Corpus build (R0)

1. Crawl RIS OGD `Bundesrecht` for SV-relevant acts (ASVG, GSVG, BSVG, B-KUVG, BPGG, FLAG, KBGG, KUG, Pflegefondsgesetz, Sozialhilfe-Grundsatzgesetz and related Verordnungen); store each § with act, paragraph, version dates, URL.
2. Load SozDok from the SV-Box; join to RIS by act and paragraph.
3. Filter German Commons Legal and Political with the `coral-nlp/llmdata` pipeline; dedup against RIS.
4. Write Parquet with `source`, `licence`, `valid_from`, `valid_to`, `text`; publish the Austrian subset as `at-sv-law` dataset.

## 5. AT-Benefits gym

### 5.1 World

- Catalog core set (24 benefits across areas A–F), office directory, process YAML, document requirements, opening hours, EKO slice, fee-schedule samples, all loaded from `packages/knowledge` exactly as in the product.
- Ground truth from the engine's rule evaluation (`process.*`, `office.resolve`, `documents.checklist`), each criterion with its RIS/SozDok citation.

### 5.2 Persona schema

```json
{
  "id": "p-000123",
  "split": "train | val | test | heldout_family",
  "household": [{
    "role": "subject | helper",
    "age": 74, "sex": "f",
    "residence": { "state": "Steiermark", "district": "Graz" },
    "insurance": { "carrier": "OEGK", "status": "pensioner", "pension_carrier": "PVA" },
    "employment": "retired", "income_band": "lt_1300",
    "care": { "pflegegeld_level": null, "needs": ["mobility", "household"] },
    "children": [], "documents_held": ["discharge_letter", "e_card"],
    "language": "de-AT", "register": "colloquial", "literacy": "low"
  }],
  "situation_text": "Meine Mutter kommt allein nicht mehr zurecht ...",
  "goal": "apply_care_allowance_for_parent",
  "noise": { "partial_knowledge": 0.3, "contradiction": 0.1, "dialect": 0.5 },
  "gold": { "benefits": ["pflegegeld", "pflegeberatung", "pflegekarenz"], "offices": {"pflegegeld": "pva-stmk"}, "documents": {"pflegegeld": ["antrag", "befunde"]}, "min_questions": 4 }
}
```

Generator: seeded per index, split assigned before rendering (Medlyn pattern), with one held-out benefit family (for example area E) and held-out phrasing styles in test. Target: 50k train, 2k val, 2k test, 1k held-out family. Gold is computed by the engine, never by an LLM.

### 5.3 Simulated user

- Open simulator for training: a Qwen3-32B-class model served with vLLM (UserRL found open simulators cost-effective and transferable). Frontier simulator for evaluation only.
- Sees only the persona card and the dialogue, never `gold`; answers only what is asked; applies `noise` (partial knowledge, contradictions, dialect); languages German, English and Turkish.
- Leakage test: a classifier must not predict gold benefits from simulator utterances above the base rate of the persona card.

### 5.4 Interface

- Python gym (`ml/gym`) with `reset(persona_id) → observation` and `step(action) → observation, reward, done`.
- `action` is one of: tool call (name, JSON input), message to the user, final plan.
- Tools are the real TypeScript brain tools exposed by a research-only tool server (`packages/brain/research-server.ts`, not part of release builds), so the trained policy uses the product's exact tool contract.
- Final plan schema: `{ benefits[], office_per_benefit{}, documents_per_benefit{}, next_step, citations[] }`.

### 5.5 Reward (starting weights)

```
R = 0.45·F1_benefits + 0.20·Acc_office + 0.15·F1_documents + 0.10·CiteValid + 0.10·NextStepCorrect
    − 0.05·max(0, q − q_min)
    − 1.0·[boundary violation]        # rule guard hit or Guard model flag on any agent turn
    − 0.5·[uncited eligibility claim]
    − 0.2·[malformed tool call]
```

Turn-level shaping (arXiv 2505.11821): +0.02 for a question that fills a slot the engine marked as missing, −0.02 for a question whose slot is already known. Trajectory scoring per UserRL. All terms are computed by code; the Guard model is the only learned component and is frozen during agent training.

### 5.6 Metrics

Benefit F1, office accuracy, document F1, excess questions (median, p90), pass^k for k = 1…8 (τ-bench), boundary violations, citation validity, tokens and latency per case. Reported per split, per language, per area and separately for the real-text population.

## 6. Model family

| Model | Base | Role in the product | Pipeline |
| --- | --- | --- | --- |
| SV-Lotse-A3B (co-primary) | `Qwen/Qwen3-30B-A3B` (30.5B total, 3.3B active, Apache 2.0) | Agent behind the model gateway | CPT (ablated) → SFT → multi-turn GRPO → DPO |
| SV-Lotse-Euro-9B (co-primary) | `utter-project/EuroLLM-9B-Instruct` (EU-funded, Apache 2.0) | Same role, European base | Identical pipeline and data |
| Control | `Qwen/Qwen3-8B` | MoE vs dense control | SFT → GRPO |
| SV-Lotse-Guard | `Qwen/Qwen3-4B`; `Qwen3-1.7B` on-device control | Boundary classifier (layer 3) and attribution verifier | SFT + calibration |
| SV-Lotse-Einfach | LoRA adapter on each agent base | B1 plain-language rewriter | SFT → DPO with NLI meaning reward |
| SV-Lotse-Embed / Rerank | `Qwen/Qwen3-Embedding-4B`; `Qwen/Qwen3-Reranker-4B` | Retrieval and reranking | Contrastive fine-tune with hard negatives |
| SV-Lotse-Point | `Qwen/Qwen2.5-VL-7B-Instruct`; 3B ablation | Resolution-ladder method 5 (point at a field) | SFT → optional GRPO with click-in-box reward |

## 7. Training on 3×H100

### 7.1 Agent pipeline (run for both co-primary bases)

| Stage | Data | Tooling | GPU layout | Starting hyperparameters | Rough budget |
| --- | --- | --- | --- | --- | --- |
| S1 Domain CPT (ablated) | 1–3B tokens: Austrian law upsampled ×4, German Commons Legal/Political | LoRA CPT on the MoE; full CPT on dense bases (FSDP) | 3 GPUs, FSDP | LoRA r = 128 on attention + experts; lr 1e-4 cosine; seq 8k | tens of GPU-hours per billion tokens (dense full CPT) |
| S2 SFT cold start | ~100k filtered teacher trajectories + 50k slot extraction + 30k statement extraction + 5k process-YAML synthesis | TRL or LLaMA-Factory | 3 GPUs, FSDP | LoRA r = 64 (MoE) / full (9B); lr 1e-5 full, 1e-4 LoRA; 2 epochs; seq 16k; loss on assistant and tool-call tokens only | tens of GPU-hours |
| S3 Multi-turn GRPO | Gym episodes; curriculum: single benefit → bundles → helper cases → held-out phrasing | verl (multi-turn agent loop, async server rollout) | GPU 0: vLLM/SGLang policy rollouts + simulator; GPUs 1–2: actor update | group 8; lr 1e-6; KL 0.001; max 12 turns; 256 episodes per step | 100–200 GPU-hours per base |
| S4 DPO polish | ~20k pairs: handoff wording, plain-language register, citation phrasing | TRL DPO | 3 GPUs | β 0.1; 1 epoch | few GPU-hours |
| S5 Serve | AWQ or FP8 for vLLM; model cards | vLLM | 1 GPU | — | — |

Teacher trajectories (S2): a frontier model plays the gym with the real tools; rejection sampling keeps only trajectories with R ≥ 0.9, zero boundary flags and valid citations.

### 7.2 Supporting models

| Model | Data | Method | Rough budget |
| --- | --- | --- | --- |
| Guard | 60k synthetic pairs (response, context) labelled supported / unsupported / boundary_violation, generated per brief prohibition with templates and LLM paraphrase; AttributionBench train | SFT classifier head via constrained label tokens; temperature scaling and threshold on validation only | few GPU-hours |
| Einfach | German4All + synthetic admin paraphrases (training); DEplain-APA (research split) | SFT, then DPO where the preferred output keeps NLI entailment with the source and meets B1 readability | few GPU-hours |
| Embed / Rerank | GerDaLIR train + 50k synthetic Austrian queries from RIS § (difficulty-graded, filtered as in arXiv 2601.14160), BM25 hard negatives | InfoNCE for the embedder; pointwise / listwise for the reranker | few GPU-hours each |
| Point | Screenshots of allowlisted Austrian portals and PDF forms at Mac resolutions; instructions and boxes from DOM / AX; ScreenSpot-v2 train; XFUND-de | SFT (SE-GUI recipe); optional GRPO with reward = click inside target box | single-digit GPU-hours |

Experiment tracking: Weights & Biases or MLflow; every run writes config, data hashes, git SHA and final metrics to `ml/results/<run>.json`.

## 8. Experiments (paper tables)

| Table | Content |
| --- | --- |
| T1 Main | Frontier API (ReAct, no engine), frontier + engine tools, each base + engine, each co-primary after SFT and after SFT+GRPO; all metrics from §5.6 |
| T2 Base comparison | SV-Lotse-A3B vs SV-Lotse-Euro-9B per metric, per language (de, en, tr), per area A–F; Qwen3-8B control; with and without CPT |
| T3 Reward ablation | Outcome-only vs turn-level shaping; with and without question penalty; with and without boundary penalty |
| T4 Simulator | Open vs frontier simulator for training; cross-evaluation |
| T5 Generalization | Held-out benefit family added as data only; synthesized vs hand-authored process YAML (schema validity, slot/step overlap, downstream F1) |
| T6 Real-text population | Hand-written Austrian utterances, SV-Box documents, CARDIO:DE letters; reported separately |
| T7 Supporting models | Guard: macro-F1, FNR/FPR on the 500-case red-team set; Einfach: SARI, Wiener Sachtextformel, NLI meaning preservation; Embed/Rerank: MTEB GerDaLIRSmall, product E3 recall@10; Point: ScreenSpot-Pro, FormFactory, Austrian portal set |
| T8 Cost and latency | Tokens/s and cost per case on 1×H100 vs API; Guard and Point latency |
| T9 Quantum | QAOA vs CP-SAT vs simulated annealing: approximation ratio, feasibility rate, depth, shots, hardware vs simulator, qubit sweep |

Statistics: 95% bootstrap intervals over personas; paired tests between systems on the same personas; pass^k from 8 trials per persona on the test split.

## 9. Quantum experiments (Qiskit, IBM hardware)

Tooling: `qiskit`, `qiskit-ibm-runtime` (Sampler V2 on an IBM Heron device), `qiskit-addon-opt-mapper` for QUBO mapping (qiskit-optimization is deprecated), OR-Tools CP-SAT and simulated annealing as baselines. Framing: no quantum advantage claim; contribution is the formulation from real administrative data and a reproducible hardware study with hashes.

### 9.1 Q-A Case scheduling

- Instance: open case steps i (appointments, document pickups, office visits) with duration d_i, deadline D_i, allowed slots from opening hours, travel time τ between offices. Instances come from AT-Benefits personas with bundles.
- Variables: x_{i,t} = 1 if step i starts in allowed slot t.
- QUBO: A·Σ_i (Σ_t x_{i,t} − 1)² + B·Σ_{overlapping (i,t),(j,u)} x_{i,t}x_{j,u} + Σ_{i,t} lateness_i(t)·x_{i,t} + C·Σ_{consecutive (i,t),(j,u)} τ(i,j)·x_{i,t}x_{j,u}.
- Sizes: 10–30 binary variables for hardware runs (sweep), larger instances on simulator and classical only.
- Variants: plain QAOA (p = 1…3), warm-start QAOA from the CP-SAT solution.
- Product: CP-SAT plans the week on the journey map; the same instances feed the quantum appendix.

### 9.2 Q-B Document set cover

- Instance: evidence requirements of a benefit bundle (elements) and documents/appointments that satisfy them (sets), from `documents.checklist` across benefits.
- Formulation: minimum set cover with slack variables (Lucas formulation), or the constrained/unconstrained twin with classical post-processing (SCOOP, arXiv 2504.10897).
- Sizes: 10–30 qubits; baselines greedy and ILP.

Output: `ml/quantum/results.json` with instance hashes, backend, transpiled depth, shots, approximation ratios, package versions.

## 10. Integration into the product

| Product role (PRD model routing) | Research model | Switch |
| --- | --- | --- |
| Orchestrator (optional open alternative) | SV-Lotse-A3B or SV-Lotse-Euro-9B via vLLM behind the gateway | `models.ts` role config; frontier remains default until T1 shows parity |
| Boundary guard (layer 3) | SV-Lotse-Guard | Cascade: local first, frontier on low confidence (Medlyn pattern) |
| Simple language | SV-Lotse-Einfach | Rewrite stage after the guard; NLI check retained |
| Embeddings and reranker | SV-Lotse-Embed / Rerank | Retrieval config; E3 must not regress |
| Resolution method 5 | SV-Lotse-Point | Replaces the vendor computer-use model behind the gateway |
| Case scheduling | CP-SAT | New `schedule.plan` server tool; quantum stays research-only |

## 11. Repository layout and commands

```
ml/                         uv-managed Python 3.12 lane (as in Medlyn)
  corpus/                   RIS OGD crawler, SozDok loader, German Commons filter
  personas/                 seeded persona generator, validation, splits
  gym/                      AT-Benefits environment, simulator client, rewards
  sft/                      teacher rollouts, rejection sampling, SFT configs
  rl/                       verl configs and reward plugins
  guard/  einfach/  retrieval/  point/
  quantum/                  QUBO builders, Qiskit runs, baselines
  eval/                     T1–T9 runners, statistics
  publish/                  HF model and dataset cards, upload
  results/                  run JSONs with hashes
paper/                      LaTeX, generated tables, tectonic build
packages/brain/research-server.ts   research-only tool server for the gym
```

| Command (from `ml/`) | Purpose |
| --- | --- |
| `uv run python -m corpus.build --acts sv` | Build the Austrian law corpus |
| `uv run python -m personas.generate --n 55000 --out data/personas` | Generate and split personas |
| `uv run python -m gym.selftest` | Check rewards against the engine on gold plans |
| `uv run python -m sft.rollout --teacher <model> --n 120000` | Teacher trajectories with rejection sampling |
| `uv run python -m sft.train --base qwen3-30b-a3b` / `--base eurollm-9b` | SFT |
| `uv run python -m rl.train --config rl/grpo-a3b.yaml` / `rl/grpo-euro9b.yaml` | Multi-turn GRPO with verl |
| `uv run python -m eval.run --tables T1,T2,...` | Paper tables |
| `uv run python -m quantum.run --backend <ibm_backend>` | Q-A and Q-B hardware runs |
| `uv run python -m publish.upload --profile <hf-user>` | Release to Hugging Face |
| `make -C paper` | Build the preprint from result files |

## 12. Paper outline

Working title: *Lotse-RL: Training Grounded Benefits-Navigation Agents with Executable Eligibility Rules for Austrian Social Insurance.*

1. Introduction: benefits navigation, the brief's medical boundary, executable rules as verifiable rewards.
2. Related work: BeNYfits/ProADA, τ-bench, UserRL, MUA-RL, turn-level rewards, German legal IR (GerDaLIR), German simplification (DEplain, German4All), GUI grounding (ScreenSpot-Pro), Medlyn.
3. System: process engine, catalog, five-layer boundary, screen-aware guidance (short; cites the PRD).
4. AT-Benefits: world, personas, simulator, reward, release.
5. Training: data, SFT, GRPO, DPO, supporting models.
6. Results: T1–T8.
7. Quantum appendix: T9.
8. Limitations: synthetic personas, simulator bias, no caseworker gold and no human study, licence-restricted eval sets, hardware noise.
9. Release: models, datasets, gym, model cards, reproducibility hashes.

## 13. Gates

| Gate | Done when |
| --- | --- |
| R0 Data | Law corpus built with licences; persona generator validated; leakage test passes; dataset cards drafted |
| R1 Gym | Gym runs the real brain tools; rewards unit-tested against the engine on gold plans; frontier baselines in T1 |
| R2 SFT | Teacher trajectories filtered; both co-primary SFT models beat their bases in T1 |
| R3 GRPO | Stable GRPO runs on both bases; T1, T2, T3 filled; zero red-team boundary violations |
| R4 Supporting models | Guard, Einfach, Embed/Rerank, Point evaluated (T7) and served behind the gateway |
| R5 Ablations | T4, T5, T6 complete |
| R6 Quantum | Q-A and Q-B hardware runs with baselines and hashes (T9) |
| R7 Paper and release | Tables generated from result files; models and datasets on the Hugging Face profile with cards; preprint built |

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Synthetic-to-real gap (Medlyn lesson) | T6 real-text population; hand-written utterances; held-out simulator and phrasing styles |
| Reward hacking (zero questions and guessing; over-asking) | Benefit/office F1 dominates; question penalty only above the engine minimum; human review of 200 sampled trajectories |
| GRPO instability on the MoE | Dense Qwen3-8B and EuroLLM-9B paths; SFT checkpoint is always shippable |
| Simulator leaks answers | Simulator sees only the persona card; leakage test in R0 |
| Boundary regressions from RL | Large negative reward; frozen Guard in the loop; red-team set never used in training; blocking gate |
| Licence limits (DEplain-APA, CARDIO:DE) | Research and eval splits only; released models trained on open data |
| Rule errors propagate into labels | Rules are the product's tested engine (E1/E2); disagreements between teacher and rules are reviewed, not silently dropped |
| Quantum queue and noise | Simulator first; small hardware instances; report noise honestly |

## 15. Sources

- Medlyn (prior work): https://github.com/Julian-AT/medlyn
- RIS OGD API: https://data.bka.gv.at/ris/api/v2.6/ ; API handbook via https://www.data.gv.at
- German Commons: https://huggingface.co/datasets/coral-nlp/german-commons ; arXiv 2510.13996 ; https://github.com/coral-nlp/llmdata
- GerDaLIR: https://github.com/lavis-nlp/GerDaLIR ; https://huggingface.co/datasets/mteb/GerDaLIR
- DEplain: https://huggingface.co/datasets/DEplain/DEplain-APA-doc ; https://aclanthology.org/2023.acl-long.908/ ; https://zenodo.org/record/7674560
- German4All: https://arxiv.org/abs/2508.17973
- DPO for German simplification: https://arxiv.org/abs/2507.01479
- EasyGerman: https://aclanthology.org/2025.konvens-2.11.pdf
- AttributionBench: https://huggingface.co/datasets/osunlp/AttributionBench ; https://aclanthology.org/2024.findings-acl.886/
- CARDIO:DE: https://www.nature.com/articles/s41597-023-02128-9
- GGPONC: https://aclanthology.org/2020.louhi-1.5.pdf
- XFUND: https://github.com/doc-analysis/XFUND
- ScreenSpot-Pro: https://arxiv.org/abs/2504.07981 ; https://github.com/likaixin2000/ScreenSpot-Pro-GUI-Grounding
- FormFactory: https://arxiv.org/abs/2506.01520 ; FormGym: https://arxiv.org/abs/2506.14079
- BeNYfits / ProADA: https://arxiv.org/abs/2502.19610
- τ-bench: https://arxiv.org/abs/2406.12045 ; https://github.com/sierra-research/tau-bench
- UserRL: https://arxiv.org/abs/2509.19736 ; MUA-RL: https://arxiv.org/abs/2508.18669 ; turn-level rewards: https://arxiv.org/abs/2505.11821
- Synthetic German legal QA from legislation: https://arxiv.org/abs/2601.14160
- verl: https://github.com/volcengine/verl
- Models: https://huggingface.co/Qwen/Qwen3-30B-A3B ; https://huggingface.co/utter-project/EuroLLM-9B-Instruct ; https://huggingface.co/Qwen/Qwen3-8B ; https://huggingface.co/Qwen/Qwen3-Embedding-4B ; https://huggingface.co/Qwen/Qwen3-Reranker-4B ; https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- Austrian-accent STT: https://huggingface.co/chris365312/whisper-large-v3-de-at
- Qiskit: https://github.com/qiskit-community/qiskit-optimization (deprecation note) ; https://quantum.cloud.ibm.com/docs/en/guides/addons (opt-mapper) ; QTIS scheduling: https://arxiv.org/abs/2511.15590 ; SCOOP: https://arxiv.org/abs/2504.10897
- SV open data (context only): https://opendata.sozialversicherung.at/
