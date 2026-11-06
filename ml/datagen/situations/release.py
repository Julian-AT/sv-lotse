"""Assemble the `situations` release: Parquet splits, card section, metrics, leakage, spot-check."""

from __future__ import annotations

import json
import random
import time
from collections import Counter, defaultdict

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .. import quality as q
from ..config import default
from ..io import family_dir, git_sha, swap_release, write_card, write_metrics, write_shard
from ..ledger import Ledger
from . import naturalize as nat
from .personas import SEED, personas_dir

SPLIT_NAME = {
    "train": "train",
    "val": "validation",
    "test": "test",
    "heldout_family": "heldout_family",
}
BCS_CODE = {"Bosnian": "bs", "Croatian": "hr", "Serbian": "sr"}


def load_natural() -> pd.DataFrame:
    files = sorted(nat.natural_dir().glob("chunk-*.parquet"))
    if not files:
        return pd.DataFrame(columns=list(nat.COLS))
    return pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)


def leakage(rows: list[dict], label: str, train_cap: int = 20000, seed: int = 0) -> dict:
    """personas.leakage protocol on arbitrary rows (household as list, gold as dict)."""
    from sklearn.feature_extraction import DictVectorizer
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics import f1_score
    from sklearn.preprocessing import MultiLabelBinarizer

    from personas.leakage import MARGIN, MIN_POSITIVES, _fit_score, card_features

    train = [r for r in rows if r["split"] == "train"]
    test = [r for r in rows if r["split"] in ("test", "val")]
    random.Random(seed).shuffle(train)
    train = train[:train_cap]
    if len(train) < 200 or len(test) < 50:
        return {"set": label, "passed": None, "reason": f"too few rows ({len(train)}/{len(test)})"}
    mlb = MultiLabelBinarizer()
    y = mlb.fit_transform([r["gold"]["benefits"] for r in train])
    keep = (y.sum(0) >= MIN_POSITIVES) & (y.sum(0) < len(train))
    labels = [lab for lab, k in zip(mlb.classes_, keep, strict=True) if k]
    m2 = MultiLabelBinarizer(classes=labels)
    y_tr = m2.fit_transform([[b for b in r["gold"]["benefits"] if b in labels] for r in train])
    y_te = m2.transform([[b for b in r["gold"]["benefits"] if b in labels] for r in test])
    tf = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=200000)
    xt_tr = tf.fit_transform([r["situation_text"] for r in train])
    xt_te = tf.transform([r["situation_text"] for r in test])
    dv = DictVectorizer()
    xc_tr = dv.fit_transform([card_features(r) for r in train])
    xc_te = dv.transform([card_features(r) for r in test])
    text_f1 = _fit_score(xt_tr, y_tr, xt_te, y_te)
    card_f1 = _fit_score(xc_tr, y_tr, xc_te, y_te)
    base = np.tile((y_tr.mean(0) >= 0.5).astype(int), (len(test), 1))
    return {
        "set": label,
        "n_train": len(train),
        "n_eval": len(test),
        "n_labels": len(labels),
        "text_f1": round(text_f1, 4),
        "card_f1": round(card_f1, 4),
        "base_rate_f1": round(float(f1_score(y_te, base, average="micro", zero_division=0)), 4),
        "margin": MARGIN,
        "passed": text_f1 <= card_f1 + MARGIN,
    }


def _js(v):
    return json.loads(v) if isinstance(v, str) and v else None


def _as_row(d: dict) -> dict:
    return {**d, "household": json.loads(d["household"]), "gold": json.loads(d["gold"])}


def build_release() -> dict:
    t0 = time.time()
    nat_df = load_natural()
    acc = nat_df[nat_df["accepted"]] if len(nat_df) else nat_df
    natural = {r["id"]: r for r in acc.to_dict("records")}
    import shutil

    rel = family_dir("situations") / "release-next"
    if rel.exists():
        shutil.rmtree(rel)
    rel.mkdir(parents=True)
    counts: Counter = Counter()
    by_lang: Counter = Counter()
    sample_template: list[dict] = []
    natural_rows: list[dict] = []
    rng = random.Random(7)
    for f in sorted(personas_dir().glob("shard-*.parquet")):
        df = pq.read_table(f).to_pandas()
        out = defaultdict(list)
        for r in df.to_dict("records"):
            n = natural.get(r["id"])
            row = {
                "id": r["id"],
                "split": SPLIT_NAME[r["split"]],
                "goal": r["goal"],
                "scenario": r["scenario"],
                "life_situation": r["life_situation"],
                "style": r["style"],
                "noise": r["noise"],
                "template_text": r["situation_text"],
                "seed": int(r["seed"]),
            }
            if n is None:
                row.update(
                    situation_text=r["situation_text"],
                    text_source="template",
                    text_language=r["text_language"],
                    text_variant=r["text_language"],
                    household=r["household"],
                    gold=r["gold"],
                    gold_benefits=list(r["gold_benefits"]),
                    quality=None,
                )
                if rng.random() < 0.03:
                    sample_template.append(_as_row({**r}))
            else:
                qual = {
                    k: n[k]
                    for k in (
                        "lang_detected",
                        "lang_confidence",
                        "n_words",
                        "rule_passed",
                        "judge_passed",
                        "judge_reason",
                        "model",
                    )
                }
                qual["judge_scores"] = _js(n["judge_scores"])
                qual["readability"] = _js(n["readability"])
                row.update(
                    situation_text=n["text"],
                    text_source="llm",
                    text_language=q.base_code(n["text_variant"]),
                    text_variant=BCS_CODE.get(n["bcs_variant"], n["text_variant"]),
                    household=n["household"],
                    gold=n["gold"],
                    gold_benefits=list(n["gold_benefits"]),
                    quality=json.dumps(qual, ensure_ascii=False, default=str),
                )
                natural_rows.append(_as_row({**row, "split": r["split"]}))
            counts[(row["split"], row["text_source"])] += 1
            by_lang[(row["text_source"], row["text_variant"])] += 1
            out[row["split"]].append(row)
        for split, rows in out.items():
            write_shard(rows, rel / split / f"{split}-{f.stem.split('-')[1]}.parquet")
    metrics = natural_metrics(nat_df, natural_rows)
    metrics["counts"] = {f"{s}/{src}": c for (s, src), c in sorted(counts.items())}
    metrics["languages"] = {f"{src}/{v}": c for (src, v), c in sorted(by_lang.items())}
    metrics["leakage"] = [
        leakage(sample_template, "template_texts_3pct_sample"),
        leakage(natural_rows, "llm_texts"),
    ]
    metrics.update(
        family="situations",
        version=default().version,
        seed=SEED,
        sha=git_sha(),
        built_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        ledger=Ledger().summary(),
        seconds=round(time.time() - t0, 1),
    )
    spot = spotcheck(natural_rows)
    (rel / "spotcheck.jsonl").write_text(
        "\n".join(json.dumps(s, ensure_ascii=False) for s in spot) + "\n"
    )
    metrics["spotcheck"] = {
        "file": "spotcheck.jsonl",
        "n": len(spot),
        "strata": "text_variant x split, up to 6 each, seed 11",
    }
    write_metrics("situations", metrics, rel)
    write_card("situations", card(metrics), rel)
    swap_release("situations", rel)
    return metrics


def natural_metrics(nat_df: pd.DataFrame, rows: list[dict]) -> dict:
    if not len(nat_df):
        return {"natural": {"generated": 0}}
    reasons: Counter = Counter()
    for r in nat_df.to_dict("records"):
        if not r["accepted"]:
            reasons[str(r.get("reject_reason") or "").split(":")[0]] += 1
    judged = nat_df[nat_df["judge_passed"].notna()]
    jp = int(judged["judge_passed"].astype(bool).sum())
    crit: defaultdict = defaultdict(list)
    for s in judged["judge_scores"].dropna():
        for k, v in json.loads(s).items():
            crit[k].append(v)
    per_lang = {}
    texts_by: defaultdict = defaultdict(list)
    for r in rows:
        texts_by[r["text_variant"]].append(r["situation_text"])
    for v, texts in sorted(texts_by.items()):
        rd = [q.readability(t, v) for t in texts[:2000]]
        keys = {k for d in rd for k in d}
        per_lang[v] = {
            "n": len(texts),
            "distinct_1": round(q.distinct_n(texts, 1), 4),
            "distinct_2": round(q.distinct_n(texts, 2), 4),
            "length": q.length_stats(texts),
            "readability_mean": {
                k: round(float(np.mean([d[k] for d in rd if k in d])), 2) for k in keys
            },
        }
    return {
        "natural": {
            "generated": int(len(nat_df)),
            "accepted": int(nat_df["accepted"].sum()),
            "acceptance_rate": round(float(nat_df["accepted"].mean()), 4),
            "reject_reasons": dict(reasons),
            "rule_pass_rate": round(float(nat_df["rule_passed"].mean()), 4),
            "judge": {
                "n": int(len(judged)),
                "passed": jp,
                "pass_rate": round(jp / len(judged), 4) if len(judged) else None,
                "wilson_95": q.wilson(jp, len(judged)),
                "criterion_means": {k: round(float(np.mean(v)), 3) for k, v in crit.items()},
                "gate": nat.GATE,
                "pass_rate_by_variant": {
                    v: round(float(g["judge_passed"].astype(bool).mean()), 4)
                    for v, g in judged.groupby("text_variant")
                },
                "rubric": nat.RUBRIC,
            },
            "tokens": {
                "prompt": int(nat_df["tokens_in"].sum()),
                "completion": int(nat_df["tokens_out"].sum()),
            },
            "per_variant": per_lang,
        }
    }


def spotcheck(rows: list[dict], per: int = 6) -> list[dict]:
    rng = random.Random(11)
    strata: defaultdict = defaultdict(list)
    for r in rows:
        strata[(r["text_variant"], r["split"])].append(r)
    out = []
    for key in sorted(strata):
        for r in rng.sample(strata[key], min(per, len(strata[key]))):
            out.append(
                {
                    "id": r["id"],
                    "split": r["split"],
                    "text_variant": r["text_variant"],
                    "template_text": r["template_text"],
                    "situation_text": r["situation_text"],
                    "gold_benefits": r["gold_benefits"],
                    "quality": json.loads(r["quality"]) if r.get("quality") else None,
                    "review": {
                        "faithful": None,
                        "no_leakage": None,
                        "language": None,
                        "natural": None,
                        "notes": "",
                    },
                }
            )
    return out


def card(m: dict) -> str:
    n = m.get("natural", {})
    j = n.get("judge", {})
    total = sum(m["counts"].values())
    llm = sum(c for k, c in m["counts"].items() if k.endswith("/llm"))
    return f"""## Config `situations`

{total:,} synthetic Austrian household personas with a structured card, an opening situation
text and engine-computed gold (benefits, offices, documents, minimum questions, criterion
citations). Generator: the seeded SV KI-Lotse persona generator (seed {m["seed"]}), split by index
before sampling; `heldout_family` holds every persona whose bundle contains area D (care), which
never occurs in the other splits; `test` contains two phrasing styles unseen in training.

- `text_source = "template"`: template text in German (incl. Austrian dialect), English or Turkish.
- `text_source = "llm"` ({llm:,} rows): the text was rewritten by
  `{default().role("bulk")["model"]}` in one of German (Austrian standard, Austrian dialect by
  state, plain language B1), English, Turkish,
  Bosnian/Croatian/Serbian, Romanian, Hungarian, Polish, Ukrainian or Arabic, matching the
  speaker's register, literacy and noise, from the persona card only. Gold for these rows was
  recomputed by the engine with the new text and language. Every LLM text passed language ID
  (lingua), no benefit/office names (gold + whole life-situation bundle), numbers only from the
  card, no contact data, length 8-220 words and MinHash near-duplicate removal, and was then
  judged by `{default().role("judge")["model"]}` on faithfulness, no leakage, language, register,
  naturalness and concern (1-5 each); a row is kept only if faithfulness, no leakage and language
  score at least 4. Judge pass rate {j.get("pass_rate")} (95 % Wilson {j.get("wilson_95")},
  n={j.get("n")}); per-variant rates are in the metrics. Acceptance rate
  {n.get("acceptance_rate")}. Per-row quality fields are in `quality` (JSON).

Rows per split and text source: {", ".join(f"{k} {v:,}" for k, v in m["counts"].items())}.

Labels are navigation hints computed by product code, not eligibility decisions. Metrics,
leakage test (text classifier vs card classifier, micro-F1) and a stratified spot-check sample are
in `situations/metrics.json`.

Columns: `id`, `split`, `goal`, `scenario`, `life_situation`, `style`, `noise` (JSON),
`situation_text`, `template_text`, `text_source`, `text_language`, `text_variant`, `household`
(JSON), `gold` (JSON), `gold_benefits`, `quality` (JSON or null), `seed`.
"""
