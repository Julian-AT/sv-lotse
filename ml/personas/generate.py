"""Seeded persona generator.

    uv run python -m personas.generate --n 55000 --out data/personas

Pipeline (Medlyn pattern): the split is a function of the index and is fixed first; the card is
then sampled from a generator seeded by (seed, index, attempt) and conditioned on the split (area-E
goals only in heldout_family); gold comes from the product engine (`POST /gold`); cards whose gold
crosses the family boundary are resampled with the next attempt; only then is the situation text
rendered (held-out phrasing styles only in test).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import Counter
from pathlib import Path

import pandas as pd

from .goals import GOALS, TARGETS, Goal
from .gold import GoldCache, fetch_gold, server_up
from .render import HELDOUT_STYLES, TRAIN_STYLES, lang_key, render
from .schema import Persona
from .vocab import (
    DISTRICT_STATES,
    HELDOUT_AREA,
    INCOME_BANDS,
    LANGUAGES,
    NEEDS,
    STATE_WEIGHTS,
    STATES,
    STATUSES,
    Vocab,
    load_vocab,
)

SPLIT_SHARES = {"train": 50, "val": 2, "test": 2, "heldout_family": 1}  # of 55
MAX_ATTEMPTS = 8
MAX_RENDER_TRIES = 6


def split_counts(n: int) -> dict[str, int]:
    total = sum(SPLIT_SHARES.values())
    counts = {s: round(n * w / total) for s, w in SPLIT_SHARES.items() if s != "train"}
    counts["train"] = n - sum(counts.values())
    return {s: counts[s] for s in SPLIT_SHARES}


def split_of(index: int, n: int) -> str:
    """Contiguous index ranges: train, val, test, heldout_family."""
    acc = 0
    for split, c in split_counts(n).items():
        acc += c
        if index < acc:
            return split
    raise IndexError(index)


def _rng(seed: int, index: int, attempt: int, salt: str) -> random.Random:
    return random.Random(f"{seed}:{index}:{attempt}:{salt}")


def _wchoice(rng: random.Random, weights: dict[str, float]) -> str:
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def goal_pool(split: str, vocab: Vocab) -> list[Goal]:
    """Scenarios allowed in a split: heldout_family only scenarios whose bundle contains the
    held-out area, every other split only scenarios whose bundle does not."""
    held = split == "heldout_family"
    return [g for g in GOALS if (HELDOUT_AREA in vocab.bundle_areas(TARGETS[g.id][1])) == held]


def _member(
    rng: random.Random,
    role: str,
    age: int,
    sex: str,
    state: str,
    district: str,
    status: str,
    income: str,
    language: str,
) -> dict:
    carrier, pension_carrier, employment, status_value = STATUSES[status]
    register = (
        rng.choices(["formal", "neutral", "colloquial", "dialect"], weights=[1, 4, 3, 2])[0]
        if language == "de-AT"
        else rng.choices(["formal", "neutral", "colloquial"], weights=[1, 4, 3])[0]
    )
    return {
        "role": role,
        "age": age,
        "sex": sex,
        "residence": {"state": state, "district": district},
        "insurance": {
            "carrier": carrier,
            "status": status_value,
            "pension_carrier": pension_carrier,
        },
        "employment": employment,
        "income_band": income,
        "care": {"pflegegeld_level": None, "needs": []},
        "children": [],
        "documents_held": [],
        "language": language,
        "register": register,
        "literacy": rng.choices(["low", "medium", "high"], weights=[2, 5, 3])[0],
    }


def sample_card(seed: int, index: int, n: int, vocab: Vocab, attempt: int = 0) -> dict:
    """Persona card (no text, no gold) for one index; private keys start with '_'."""
    split = split_of(index, n)
    rng = _rng(seed, index, attempt, "card")
    pool = goal_pool(split, vocab)
    goal = rng.choices(pool, weights=[g.weight for g in pool])[0]
    benefit, life_situation = TARGETS[goal.id]
    persp = rng.choice(goal.persp)
    state = _wchoice(rng, STATE_WEIGHTS)
    # District only where the office rules read it (Vienna, Styria: GET /catalog/summary
    # vocabulary.districts); elsewhere a district value would match no rule.
    town = rng.choice(STATES[state])
    district = town if state in DISTRICT_STATES else None
    if goal.id == "basic_income_support" and state == "Steiermark":
        benefit = "sozialhilfe-steiermark"
    language = _wchoice(rng, LANGUAGES)
    status = rng.choice(goal.statuses)
    age = rng.randint(*goal.age)
    if status.startswith("pensioner"):
        age = max(age, 60)
    if status == "student":
        age = min(age, 30)
    sex = rng.choice(goal.sexes)
    income = rng.choice(goal.income)
    if status.startswith("pensioner") and income == "gt_3000" and rng.random() < 0.7:
        income = "1300_2000"
    subject = _member(rng, "subject", age, sex, state, district, status, income, language)
    if goal.needs:
        k = rng.randint(1, 4)
        subject["care"]["needs"] = sorted(rng.sample(NEEDS, k))
        if rng.random() < 0.25:
            subject["care"]["pflegegeld_level"] = rng.randint(1, 4)
    if goal.children:
        lo, hi, amin, amax = goal.children
        subject["children"] = [{"age": rng.randint(amin, amax)} for _ in range(rng.randint(lo, hi))]
        subject["children"].sort(key=lambda c: -c["age"])
    # Documents: each of the goal benefit's catalog documents is held with p=0.35, plus e-card.
    catalog_docs = vocab.benefits[benefit].documents if benefit in vocab.benefits else []
    docs = {d for d in catalog_docs if rng.random() < 0.35}
    if status != "uninsured":
        docs.add("e-card")
    subject["documents_held"] = sorted(docs)
    household = [subject]
    rel = None
    if persp == "other":
        rel = rng.choice(
            ["mother", "mother", "father", "grandmother", "neighbour_f"]
            if age >= 65
            else ["mother", "father", "wife", "husband"]
        )
        subject["sex"] = "m" if rel in ("father", "husband") else "f"
        helper_age = (
            max(18, min(age - rng.randint(20, 35), 70))
            if rel != "neighbour_f"
            else rng.randint(30, 70)
        )
        if rel in ("wife", "husband"):
            helper_age = max(18, age + rng.randint(-5, 5))
        helper_status = rng.choice(
            ("employed", "employed", "self_employed", "pensioner", "co_insured")
        )
        if helper_status == "pensioner" and helper_age < 60:
            helper_status = "employed"
        helper = _member(
            rng,
            "helper",
            helper_age,
            rng.choice(("f", "m")),
            state,
            district,
            helper_status,
            rng.choice(INCOME_BANDS),
            language,
        )
        household.append(helper)
    speaker = household[-1]
    dialect = rng.random() * (0.9 if speaker["register"] == "dialect" else 0.3)
    if language != "de-AT":
        dialect = 0.0
    noise = {
        "partial_knowledge": round(rng.uniform(0.0, 0.5), 2),
        "contradiction": round(rng.choice((0.0, 0.0, 0.05, 0.1, 0.2, 0.3)), 2),
        "dialect": round(dialect, 2),
    }
    return {
        "id": f"p-{index:06d}",
        "split": split,
        "household": household,
        "goal": benefit,
        "noise": noise,
        "_scenario": goal.id,
        "_life_situation": life_situation,
        "_persp": persp,
        "_status": status,
        "_rel": rel or "mother",
        "_attempt": attempt,
    }


def gold_request(row: dict) -> dict:
    """What the engine sees: household, goal, life situation and the opening text."""
    return {
        "household": row["household"],
        "goal": row["goal"],
        "life_situation": row["life_situation"],
        "situation_text": row["situation_text"],
    }


def _style(seed: int, index: int, split: str) -> str:
    rng = _rng(seed, index, 0, "style")
    if split == "test" and rng.random() < 0.5:
        return rng.choice(HELDOUT_STYLES)
    return rng.choice(TRAIN_STYLES)


def forbidden_names(vocab: Vocab, benefit_ids: list[str]) -> list[str]:
    out: list[str] = []
    for bid in benefit_ids:
        b = vocab.benefits.get(bid)
        if not b:
            continue
        name = b.name.lower()
        out.append(name)
        for sep in (
            " – ",
            " bei ",
            " für ",
            " auf ",
            " einschließlich ",
            " und ",
            " durch ",
            " in ",
        ):
            name = name.split(sep)[0]
        if len(name) >= 6:
            out.append(name)
    return sorted(set(out))


def bundle_names(vocab: Vocab, life_situation: str) -> list[str]:
    """Names of every benefit in the bundle: a superset of any gold the engine can return."""
    ids = [b.id for b in vocab.benefits.values() if life_situation in b.life_situations]
    return forbidden_names(vocab, ids)


EXTRA_COLUMNS = ("scenario", "life_situation", "style", "text_language")


def render_persona(card: dict, seed: int, vocab: Vocab) -> dict | None:
    """Row with situation text, or None if every rendering named a bundle benefit."""
    index = int(card["id"][2:])
    style = _style(seed, index, card["split"])
    bad = bundle_names(vocab, card["_life_situation"])
    for t in range(MAX_RENDER_TRIES):
        rng = _rng(seed, index, card["_attempt"], f"text{t}")
        text = render(card, style, rng, variant_offset=t)
        low = text.lower()
        if not any(name in low for name in bad):
            row = {k: v for k, v in card.items() if not k.startswith("_")}
            row["situation_text"] = text
            row["scenario"] = card["_scenario"]
            row["life_situation"] = card["_life_situation"]
            row["style"] = style
            row["text_language"] = lang_key(_speaker(row)["language"])
            row["_attempt"] = card["_attempt"]
            return row
    return None


def make_row(seed: int, index: int, n: int, vocab: Vocab, attempt: int = 0) -> dict | None:
    for a in range(attempt, MAX_ATTEMPTS):
        row = render_persona(sample_card(seed, index, n, vocab, a), seed, vocab)
        if row is not None:
            return row
    return None


def crosses_family(split: str, gold: dict | None, vocab: Vocab) -> bool:
    if gold is None:
        return False
    areas = {vocab.area_of(b) for b in gold.get("benefits") or []}
    if split == "heldout_family":
        return HELDOUT_AREA not in areas
    return HELDOUT_AREA in areas


def generate(
    n: int, seed: int, out: Path, use_gold: bool, concurrency: int = 32, log=print
) -> dict:
    vocab = load_vocab(use_server=use_gold)
    t0 = time.time()
    rows: list[dict | None] = [make_row(seed, i, n, vocab) for i in range(n)]
    stats: Counter = Counter()
    stats["render_failed"] = sum(r is None for r in rows)
    log(f"rendered {n} personas ({time.time() - t0:.0f}s)")
    gold_errors: dict[str, str] = {}
    if use_gold:
        cache = GoldCache(out / "gold-cache-v2.sqlite")
        pending = [i for i in range(n) if rows[i] is not None]
        for rnd in range(MAX_ATTEMPTS):
            if not pending:
                break
            golds, errs = fetch_gold(
                [gold_request(rows[i]) for i in pending], cache, concurrency=concurrency
            )
            gold_errors.update(errs)
            nxt = []
            for i, g in zip(pending, golds, strict=True):
                row = rows[i]
                row["gold"] = g
                if g is not None and crosses_family(row["split"], g, vocab):
                    stats["resampled_family_boundary"] += 1
                    new = make_row(seed, i, n, vocab, row["_attempt"] + 1)
                    if new is not None:
                        rows[i] = new
                        nxt.append(i)
            log(
                f"gold round {rnd}: {len(pending)} queried, {len(nxt)} resampled,"
                f" {len(errs)} errors ({time.time() - t0:.0f}s)"
            )
            pending = nxt
    rows_by_split: dict[str, list[dict]] = {s: [] for s in SPLIT_SHARES}
    for row in rows:
        if row is None:
            continue
        if use_gold and (
            row.get("gold") is None or crosses_family(row["split"], row["gold"], vocab)
        ):
            stats["dropped_gold_missing_or_boundary"] += 1
            continue
        row.pop("_attempt", None)
        row["gold"] = _normalise_gold(row.get("gold"))
        Persona.model_validate({k: v for k, v in row.items() if k not in EXTRA_COLUMNS})
        rows_by_split[row["split"]].append(row)
    write_splits(rows_by_split, out)
    return {
        "n_requested": n,
        "seed": seed,
        "heldout_area": HELDOUT_AREA,
        "vocab_source": vocab.source,
        "gold": use_gold,
        "split_counts": {s: len(v) for s, v in rows_by_split.items()},
        "gold_errors": len(gold_errors),
        "gold_error_examples": list(gold_errors.values())[:5],
        "stats": dict(stats),
        "seconds": round(time.time() - t0, 1),
    }


def _speaker(row: dict) -> dict:
    return next((m for m in row["household"] if m["role"] == "helper"), row["household"][0])


def _normalise_gold(g: dict | None) -> dict | None:
    """Keep the engine's gold verbatim; only default the §5.2 keys."""
    if g is None:
        return None
    out = dict(g)
    out["benefits"] = list(g.get("benefits") or [])
    out["offices"] = dict(g.get("offices") or {})
    out["documents"] = dict(g.get("documents") or {})
    out["min_questions"] = int(g.get("min_questions") or 0)
    out["citations"] = list(g.get("citations") or [])
    return out


def write_splits(rows_by_split: dict[str, list[dict]], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for split, rows in rows_by_split.items():
        with (out / f"{split}.jsonl").open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
        df = pd.DataFrame(
            {
                "id": [r["id"] for r in rows],
                "split": [r["split"] for r in rows],
                "goal": [r["goal"] for r in rows],
                "situation_text": [r["situation_text"] for r in rows],
                "text_language": [r["text_language"] for r in rows],
                "style": [r["style"] for r in rows],
                "scenario": [r["scenario"] for r in rows],
                "life_situation": [r["life_situation"] for r in rows],
                "household": [json.dumps(r["household"], ensure_ascii=False) for r in rows],
                "noise": [json.dumps(r["noise"]) for r in rows],
                "gold": [json.dumps(r["gold"], ensure_ascii=False) for r in rows],
                "gold_benefits": [(r["gold"] or {}).get("benefits", []) for r in rows],
            }
        )
        df.to_parquet(out / f"{split}.parquet", index=False)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--n", type=int, default=55000)
    ap.add_argument("--seed", type=int, default=20261106)
    ap.add_argument("--out", type=Path, default=Path("data/personas"))
    ap.add_argument("--no-gold", action="store_true", help="skip /gold (development only)")
    ap.add_argument("--concurrency", type=int, default=32)
    args = ap.parse_args(argv)
    use_gold = not args.no_gold
    if use_gold and not server_up():
        print(
            "research tool server is not up (GET /health failed); use --no-gold for a dry run",
            file=sys.stderr,
        )
        return 2
    summary = generate(args.n, args.seed, args.out, use_gold, args.concurrency)
    (args.out / "generate-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
