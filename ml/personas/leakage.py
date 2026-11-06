"""Leakage test: the situation text must not predict gold benefits better than the persona card.

Two one-vs-rest logistic-regression classifiers are trained on the train split and scored on the
test split (micro-F1 over gold benefits): one on TF-IDF features of `situation_text`, one on one-hot
features of the persona card (household fields and goal, no text). The text is rendered from the
card, so any text advantage beyond MARGIN means the renderer leaks information that the card does
not hold (for example benefit names). The test fails if text_f1 > card_f1 + MARGIN.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.multiclass import OneVsRestClassifier
from sklearn.preprocessing import MultiLabelBinarizer

from .validate import load_split

MARGIN = 0.02
TRAIN_CAP = 20000
MIN_POSITIVES = 5


def card_features(row: dict) -> dict:
    f: dict[str, float] = {f"goal={row['goal']}": 1.0, f"hh={len(row['household'])}": 1.0}
    for m in row["household"]:
        p = m["role"]
        f[f"{p}.age_bucket={m['age'] // 5}"] = 1.0
        f[f"{p}.sex={m['sex']}"] = 1.0
        f[f"{p}.state={m['residence']['state']}"] = 1.0
        f[f"{p}.carrier={m['insurance']['carrier']}"] = 1.0
        f[f"{p}.status={m['insurance']['status']}"] = 1.0
        f[f"{p}.pension={m['insurance']['pension_carrier']}"] = 1.0
        f[f"{p}.employment={m['employment']}"] = 1.0
        f[f"{p}.income={m['income_band']}"] = 1.0
        f[f"{p}.pflegegeld={m['care']['pflegegeld_level']}"] = 1.0
        f[f"{p}.n_children={len(m['children'])}"] = 1.0
        for need in m["care"]["needs"]:
            f[f"{p}.need={need}"] = 1.0
        for d in m["documents_held"]:
            f[f"{p}.doc={d}"] = 1.0
        for c in m["children"]:
            f[f"{p}.child_age_bucket={c['age'] // 3}"] = 1.0
        f[f"{p}.language={m['language']}"] = 1.0
    return f


def _fit_score(x_tr, y_tr, x_te, y_te) -> float:
    clf = OneVsRestClassifier(LogisticRegression(max_iter=2000, C=4.0), n_jobs=-1)
    clf.fit(x_tr, y_tr)
    return float(f1_score(y_te, clf.predict(x_te), average="micro", zero_division=0))


def leakage_test(data: Path, eval_split: str = "test", seed: int = 0) -> dict:
    train = [r for r in load_split(data, "train") if r.get("gold")]
    random.Random(seed).shuffle(train)
    train = train[:TRAIN_CAP]
    test = [r for r in load_split(data, eval_split) if r.get("gold")]
    if not train or not test:
        return {"passed": False, "reason": "no gold-labelled rows"}
    mlb = MultiLabelBinarizer()
    y_tr = mlb.fit_transform([r["gold"]["benefits"] for r in train])
    keep = np.asarray(y_tr.sum(0)).ravel() >= MIN_POSITIVES
    keep &= np.asarray(y_tr.sum(0)).ravel() < len(train)
    labels = [lab for lab, k in zip(mlb.classes_, keep, strict=True) if k]
    mlb2 = MultiLabelBinarizer(classes=labels)
    y_tr = mlb2.fit_transform([[b for b in r["gold"]["benefits"] if b in labels] for r in train])
    y_te = mlb2.transform([[b for b in r["gold"]["benefits"] if b in labels] for r in test])

    tf = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, max_features=200000)
    xt_tr = tf.fit_transform([r["situation_text"] for r in train])
    xt_te = tf.transform([r["situation_text"] for r in test])
    dv = DictVectorizer()
    xc_tr = dv.fit_transform([card_features(r) for r in train])
    xc_te = dv.transform([card_features(r) for r in test])

    text_f1 = _fit_score(xt_tr, y_tr, xt_te, y_te)
    card_f1 = _fit_score(xc_tr, y_tr, xc_te, y_te)
    # Base rate: predict every label whose train prevalence is >= 0.5.
    prev = y_tr.mean(0)
    base_pred = np.tile((prev >= 0.5).astype(int), (len(test), 1))
    base_f1 = float(f1_score(y_te, base_pred, average="micro", zero_division=0))
    return {
        "eval_split": eval_split,
        "n_train": len(train),
        "n_eval": len(test),
        "n_labels": len(labels),
        "metric": "micro-F1 over gold benefits",
        "text_f1": round(text_f1, 4),
        "card_f1": round(card_f1, 4),
        "base_rate_f1": round(base_f1, 4),
        "margin": MARGIN,
        "passed": text_f1 <= card_f1 + MARGIN,
        "classifier": "OneVsRest LogisticRegression(C=4); text: TF-IDF 1-2 grams; card: one-hot",
    }


if __name__ == "__main__":
    import sys

    print(
        json.dumps(
            leakage_test(Path(sys.argv[1] if len(sys.argv) > 1 else "data/personas")), indent=2
        )
    )
