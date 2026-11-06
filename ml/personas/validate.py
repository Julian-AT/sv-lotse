"""Validate a generated persona set and write ml/results/personas-<gitsha>.json."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

from .generate import EXTRA_COLUMNS, forbidden_names
from .goals import GOALS_BY_ID
from .render import HELDOUT_STYLES
from .schema import SPLITS, Persona
from .vocab import HELDOUT_AREA, load_vocab

ML = Path(__file__).resolve().parents[1]


def git_sha() -> str:
    return (
        subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ML
        ).stdout.strip()
        or "nogit"
    )


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_split(data: Path, split: str) -> list[dict]:
    p = data / f"{split}.jsonl"
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line]


def _share(c: Counter, total: int) -> dict[str, float]:
    return (
        {k: round(v / total, 4) for k, v in sorted(c.items(), key=lambda kv: -kv[1])}
        if total
        else {}
    )


def validate(data: Path) -> dict:
    vocab = load_vocab(use_server=True)
    report: dict = {
        "data_dir": str(data),
        "vocab_source": vocab.source,
        "splits": {},
        "checks": {},
        "files": {},
    }
    errors: list[str] = []
    ids_by_split: dict[str, set[str]] = {}
    heldout_with_area = 0
    texts_by_split: dict[str, set[str]] = {}
    for split in SPLITS:
        rows = load_split(data, split)
        n = len(rows)
        c: dict[str, Counter] = {
            k: Counter()
            for k in (
                "text_language",
                "scenario_area",
                "life_situation",
                "scenario",
                "carrier",
                "status",
                "state",
                "style",
                "goal",
                "register",
                "gold_area",
                "gold_benefit",
                "gold_warning",
                "household_size",
            )
        }
        gold_empty = gold_missing = leaks = schema_fail = gold_warned = 0
        min_q = []
        for r in rows:
            try:
                Persona.model_validate({k: v for k, v in r.items() if k not in EXTRA_COLUMNS})
            except Exception as e:  # noqa: BLE001
                schema_fail += 1
                if len(errors) < 10:
                    errors.append(f"{r.get('id')}: {e}")
            subj = next(m for m in r["household"] if m["role"] == "subject")
            c["text_language"][r["text_language"]] += 1
            c["scenario_area"][GOALS_BY_ID[r["scenario"]].area] += 1
            c["life_situation"][r["life_situation"]] += 1
            c["scenario"][r["scenario"]] += 1
            c["carrier"][subj["insurance"]["carrier"]] += 1
            c["status"][subj["insurance"]["status"]] += 1
            c["state"][subj["residence"]["state"]] += 1
            c["style"][r["style"]] += 1
            c["goal"][r["goal"]] += 1
            c["register"][r["household"][-1]["register"]] += 1
            c["household_size"][str(len(r["household"]))] += 1
            g = r.get("gold")
            if g is None:
                gold_missing += 1
                continue
            if not g["benefits"]:
                gold_empty += 1
            if g.get("warnings"):
                gold_warned += 1
                for w in g["warnings"]:
                    c["gold_warning"][str(w)[:160]] += 1
            if split == "heldout_family" and any(
                vocab.area_of(b) == HELDOUT_AREA for b in g["benefits"]
            ):
                heldout_with_area += 1
            min_q.append(g["min_questions"])
            for b in g["benefits"]:
                c["gold_benefit"][b] += 1
                c["gold_area"][vocab.area_of(b) or "?"] += 1
            low = r["situation_text"].lower()
            if any(name in low for name in forbidden_names(vocab, g["benefits"])):
                leaks += 1
        ids_by_split[split] = {r["id"] for r in rows}
        texts_by_split[split] = {r["situation_text"] for r in rows}
        report["splits"][split] = {
            "n": n,
            "schema_failures": schema_fail,
            "gold_missing": gold_missing,
            "gold_empty": gold_empty,
            "gold_empty_share": round(gold_empty / n, 4) if n else None,
            "gold_name_in_text": leaks,
            "gold_with_warnings": gold_warned,
            "gold_with_warnings_share": round(gold_warned / n, 4) if n else None,
            "gold_warning_counts": dict(c["gold_warning"].most_common(20)),
            "min_questions_mean": round(sum(min_q) / len(min_q), 3) if min_q else None,
            "mean_text_chars": round(sum(len(r["situation_text"]) for r in rows) / n, 1)
            if n
            else None,
            **{
                f"dist_{k}": _share(v, n)
                for k, v in c.items()
                if k not in ("gold_benefit", "gold_area", "gold_warning")
            },
            "gold_benefit_counts": dict(c["gold_benefit"].most_common()),
            "gold_area_counts": dict(c["gold_area"].most_common()),
        }
        for ext in ("jsonl", "parquet"):
            p = data / f"{split}.{ext}"
            if p.exists():
                report["files"][p.name] = {"sha256": sha256(p), "bytes": p.stat().st_size}

    s = report["splits"]
    non_ho = [x for x in SPLITS if x != "heldout_family"]
    checks = {
        "ids_disjoint": all(
            not (ids_by_split[a] & ids_by_split[b])
            for i, a in enumerate(SPLITS)
            for b in SPLITS[i + 1 :]
        ),
        "heldout_area": HELDOUT_AREA,
        "heldout_life_situations_disjoint": not (
            set(s["heldout_family"]["dist_life_situation"])
            & set().union(*(s[x]["dist_life_situation"] for x in non_ho))
        ),
        "heldout_area_absent_outside_heldout_gold": all(
            HELDOUT_AREA not in s[x]["gold_area_counts"] for x in non_ho
        ),
        "heldout_split_all_gold_in_area": heldout_with_area == s["heldout_family"]["n"],
        "heldout_styles_only_in_test": all(
            not (set(HELDOUT_STYLES) & set(s[x]["dist_style"])) for x in SPLITS if x != "test"
        ),
        "test_has_heldout_styles": bool(set(HELDOUT_STYLES) & set(s["test"]["dist_style"])),
        "schema_failures": sum(s[x]["schema_failures"] for x in SPLITS),
        "gold_name_in_text": sum(s[x]["gold_name_in_text"] for x in SPLITS),
        "text_overlap_train_test": len(texts_by_split["train"] & texts_by_split["test"]),
        "text_overlap_train_val": len(texts_by_split["train"] & texts_by_split["val"]),
        "gold_missing": sum(s[x]["gold_missing"] for x in SPLITS),
        "gold_with_warnings": sum(s[x]["gold_with_warnings"] for x in SPLITS),
        "schema_error_examples": errors,
    }
    checks["passed"] = bool(
        checks["ids_disjoint"]
        and checks["heldout_life_situations_disjoint"]
        and checks["heldout_area_absent_outside_heldout_gold"]
        and checks["heldout_split_all_gold_in_area"]
        and checks["heldout_styles_only_in_test"]
        and checks["schema_failures"] == 0
        and checks["gold_name_in_text"] == 0
    )
    report["checks"] = checks
    summ = data / "generate-summary.json"
    if summ.exists():
        report["generation"] = json.loads(summ.read_text())
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ML / "data" / "personas")
    ap.add_argument("--leakage", action="store_true", help="also run the leakage test")
    args = ap.parse_args(argv)
    report = validate(args.data)
    if args.leakage:
        from .leakage import leakage_test

        report["leakage"] = leakage_test(args.data)
    report["git_sha"] = git_sha()
    out = ML / "results" / f"personas-{report['git_sha']}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(
        json.dumps(
            {
                "checks": report["checks"],
                "leakage": report.get("leakage"),
                "counts": {k: v["n"] for k, v in report["splits"].items()},
            },
            indent=2,
        )
    )
    print(f"wrote {out}")
    ok = report["checks"]["passed"] and (not args.leakage or report["leakage"]["passed"])
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
