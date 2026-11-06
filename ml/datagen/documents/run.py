# ruff: noqa: E501
"""Runner: `uv run python -m datagen.documents.run --tranche 1` (from ml/).

Resumable and budget-aware. Personas are walked in a fixed seeded order per split; each persona
yields one document (type chosen from its scenario). Work proceeds in chunks: specs -> model
rounds -> render/verify/scan/OCR -> one Parquet shard per split and chunk under
`<output_root>/documents/release/<split>/`. Document ids already present in shards are skipped,
so a restart continues where it stopped (model calls replay from the core's cache). The run stops
cleanly when the documents pool is exhausted (`BudgetExceeded` or budget errors in a chunk), when
`--n` documents exist, or when the disk cap is reached.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow.parquet as pq

from .. import io as dio
from ..config import default
from ..llm import LLM, BudgetExceeded, QuotaError
from ..quality import NearDup
from .generate import Outcome, build_row, run_model_rounds
from .judge import judge_rows
from .spec import DocSpec, build_spec

FAMILY = "documents"
ML = Path(__file__).resolve().parents[2]
SPLIT_SHARES = {"train": 0.8, "val": 0.05, "test": 0.05, "heldout_family": 0.1}
TRANCHES = {1: 4000, 2: 20000, 3: 60000}
MAX_GB = 4.0


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def personas_dir(arg: str | None) -> Path:
    for p in [
        arg,
        ML / "data" / "personas",
        ML.parents[1] / "sv-lotse" / "ml" / "data" / "personas",
    ]:
        if p and (Path(p) / "train.parquet").exists():
            return Path(p)
    raise SystemExit("personas parquet not found; pass --personas <dir> (ml/data/personas)")


def load_personas(pdir: Path, split: str, seed: int) -> list[dict[str, Any]]:
    df = pd.read_parquet(
        pdir / f"{split}.parquet",
        columns=["id", "split", "goal", "scenario", "life_situation", "household", "gold"],
    )
    rows = df.to_dict("records")
    random.Random(f"{seed}-{split}").shuffle(rows)
    return rows


def decode(row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for k in ("household", "gold"):
        if isinstance(out[k], str):
            out[k] = json.loads(out[k])
    return out


def existing(release: Path) -> tuple[set[str], dict[str, int], list[tuple[str, str]]]:
    ids: set[str] = set()
    next_index: dict[str, int] = {}
    texts: list[tuple[str, str]] = []
    for f in sorted(release.glob("*/*.parquet")):
        t = pq.read_table(f, columns=["id", "doc_type", "sentences"])
        for i, dtp, sents in zip(
            t["id"].to_pylist(), t["doc_type"].to_pylist(), t["sentences"].to_pylist(), strict=True
        ):
            ids.add(i)
            if dtp != "prescription":
                texts.append((i, " ".join(s["text"] for s in json.loads(sents))))
        split = f.parent.name
        idx = int(f.stem.split("-")[-1])
        next_index[split] = max(next_index.get(split, 0), idx + 1)
    return ids, next_index, texts


def plan(pdir: Path, target: int, seed: int, done: set[str]) -> list[DocSpec]:
    """Deterministic list of specs for `target` documents (split quotas), skipping done ids."""
    specs: list[DocSpec] = []
    for split, share in SPLIT_SHARES.items():
        quota = round(target * share)
        rows = load_personas(pdir, split, seed)
        n = 0
        for row in rows:
            if n >= quota:
                break
            spec = build_spec(decode(row), None, seed)
            if spec is None:
                continue
            n += 1
            if spec.doc_id not in done:
                specs.append(spec)
    # interleave splits so every chunk carries all of them
    random.Random(seed).shuffle(specs)
    return specs


def _judge_error(v: dict | None) -> bool:
    return not v or str(v.get("reason", "")).startswith("judge error")


def _build(o: Outcome, scan_share: float):
    return build_row(o, scan_share)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tranche", type=int, default=1)
    ap.add_argument(
        "--n", type=int, default=None, help="target number of documents (default per tranche)"
    )
    ap.add_argument("--chunk", type=int, default=96)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--scan-share", type=float, default=0.35)
    ap.add_argument("--workers", type=int, default=6, help="processes for render/scan/OCR")
    ap.add_argument("--personas", default=None)
    ap.add_argument("--concurrency", type=int, default=4, help="max concurrent model calls")
    ap.add_argument("--no-judge", dest="judge", action="store_false", help="skip the judge filter")
    ap.add_argument("--fake", action="store_true", help="fake transport (dry run, no model calls)")
    ap.add_argument(
        "--min-remaining", type=int, default=400_000, help="stop when the pool has fewer tokens"
    )
    args = ap.parse_args(argv)

    target = args.n or TRANCHES.get(args.tranche, 4000)
    pdir = personas_dir(args.personas)
    if args.fake:
        from ..transport import FakeTransport
        from .fake import responder

        llm = LLM(FAMILY, transport=FakeTransport(responder, batch_api=False))
    else:
        cfg = default()
        # shared proxy: cap concurrency (the core halves it on 429 and backs off)
        cfg.raw["concurrency"] = {"start": args.concurrency, "max": args.concurrency, "min": 1}
        llm = LLM(FAMILY, config=cfg)
    release = dio.release_dir(FAMILY)
    done, next_index, texts = existing(release)
    rejected_path = dio.family_dir(FAMILY) / "rejected.jsonl"
    if rejected_path.exists():
        done |= {
            json.loads(line)["id"]
            for line in rejected_path.read_text().splitlines()
            if line.strip()
        }
    dedup = NearDup(threshold=0.85)
    for i, t in texts:
        dedup.add(i, t)
    specs = plan(pdir, target, args.seed, done)
    if args.fake:
        from .fake import register

        for s in specs:
            register(s)
    log(
        f"documents: {len(done)} existing, {len(specs)} to generate (target {target}), remaining {llm.remaining()}"
    )
    stats = {
        "written": 0,
        "invalid": 0,
        "render_fail": 0,
        "dup": 0,
        "tokens": 0,
        "judged": 0,
        "judge_pass": 0,
        "judge_fail": 0,
        "judge_error": 0,
    }
    reject_log = (dio.family_dir(FAMILY) / "rejected.jsonl").open("a")
    pool = ProcessPoolExecutor(max_workers=args.workers)
    try:
        for c in range(0, len(specs), args.chunk):
            rem = llm.remaining()
            if not args.fake and min(rem["family"], rem["total"]) < args.min_remaining:
                log(f"stop: budget nearly exhausted {rem}")
                break
            if shutil.disk_usage(dio.family_dir(FAMILY)).free < 2e9:
                log("stop: less than 2 GB free disk")
                break
            if sum(f.stat().st_size for f in release.rglob("*.parquet")) / 1e9 > MAX_GB:
                log("stop: disk cap reached")
                break
            chunk = specs[c : c + args.chunk]
            try:
                outcomes = run_model_rounds(chunk, llm, log=log)
            except BudgetExceeded as e:
                log(f"stop: {e}")
                break
            except QuotaError as e:
                log(f"stop: quota {e}")
                break
            except OSError as e:  # e.g. a full disk on the shared machine: wait, then retry once
                log(f"os error {e}; retrying this chunk in 120 s")
                time.sleep(120)
                if shutil.disk_usage(dio.family_dir(FAMILY)).free < 2e9:
                    log("stop: less than 2 GB free disk")
                    break
                outcomes = run_model_rounds(chunk, llm, log=log)
            ok = [o for o in outcomes if o.sections is not None]
            for o in outcomes:
                if o.sections is None and not o.budget_stop:
                    log(f"invalid {o.spec.doc_id} ({o.spec.doc_type}): {o.errors[:2]}")
            stats["invalid"] += sum(1 for o in outcomes if o.sections is None and not o.budget_stop)
            stats["tokens"] += sum(
                o.usage["prompt_tokens"] + o.usage["completion_tokens"] for o in outcomes
            )
            rows_by_split: dict[str, list[dict]] = {}
            for o, (row, problems) in zip(
                ok, pool.map(_build, ok, [args.scan_share] * len(ok)), strict=True
            ):
                if row is None:
                    stats["render_fail"] += 1
                    log(f"render/verify failed {o.spec.doc_id}: {problems[:3]}")
                    continue
                if row["doc_type"] != "prescription":
                    text = " ".join(s["text"] for s in json.loads(row["sentences"]))
                    if dedup.add(row["id"], text):
                        stats["dup"] += 1
                        continue
                rows_by_split.setdefault(row["split"], []).append(row)
            if args.judge:
                to_judge = [
                    r
                    for rs in rows_by_split.values()
                    for r in rs
                    if r["doc_type"] != "prescription"
                ]
                verdicts = judge_rows(to_judge, llm)
                for wait in (15, 45, 90):  # judge errors (429 etc.) are retried, never rejections
                    errored = [r for r in to_judge if _judge_error(verdicts.get(r["id"]))]
                    if not errored:
                        break
                    log(f"judge errors for {len(errored)} documents; retry in {wait}s")
                    time.sleep(wait)
                    verdicts.update(judge_rows(errored, llm))
                for split in list(rows_by_split):
                    kept = []
                    for r in rows_by_split[split]:
                        v = verdicts.get(r["id"])
                        if r["doc_type"] == "prescription":
                            r["judge"] = None
                            kept.append(r)
                            continue
                        if _judge_error(v):
                            stats["judge_error"] += 1  # not written, not rejected: retried next run
                            continue
                        r["judge"] = json.dumps(v or {}, ensure_ascii=False)
                        stats["judged"] += 1
                        if v and v.get("passed"):
                            stats["judge_pass"] += 1
                            kept.append(r)
                        else:
                            stats["judge_fail"] += 1
                            reject_log.write(
                                json.dumps(
                                    {"id": r["id"], "doc_type": r["doc_type"], "judge": v},
                                    ensure_ascii=False,
                                )
                                + "\n"
                            )
                            reject_log.flush()
                    rows_by_split[split] = kept
            if not args.judge:
                for rs in rows_by_split.values():
                    for r in rs:
                        r["judge"] = None
            for split, rows in rows_by_split.items():
                if not rows:
                    continue
                idx = next_index.get(split, 0)
                dio.write_release_shard(FAMILY, split, idx, rows)
                next_index[split] = idx + 1
                stats["written"] += len(rows)
            log(f"chunk {c // args.chunk}: {stats} remaining={llm.remaining()['family']}")
            if any(o.budget_stop for o in outcomes):
                log("stop: budget refused requests in this chunk")
                break
    finally:
        pool.shutdown()
    log(f"done: {stats}")
    hist = dio.family_dir(FAMILY) / "run_stats.jsonl"
    with hist.open("a") as fh:
        fh.write(
            json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "args": vars(args), **stats})
            + "\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
