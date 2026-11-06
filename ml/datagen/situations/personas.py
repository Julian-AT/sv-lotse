"""1,000,000 engine-gold personas (no LLM) in Parquet shards.

    uv run python -m datagen.situations.personas --n 1000000 --workers 4

Same generator and split logic as `personas.generate` (split fixed by index first, area-D family
held out, resampling across the family boundary, held-out phrasing styles only in test) with a
new seed space (SEED). Gold comes from the research tool server (`POST /gold`) with high
concurrency; nothing is cached on disk except the finished shards, which makes the run resumable
(a shard that exists is skipped). Output: <output_root>/situations/personas/shard-NNNNN.parquet.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import httpx

from personas.generate import (
    MAX_ATTEMPTS,
    crosses_family,
    gold_request,
    make_row,
    split_counts,
)
from personas.generate import (
    _normalise_gold as normalise_gold,
)
from personas.gold import server_up, trim
from personas.vocab import GOLD_URL, load_vocab

from ..config import default
from ..io import write_shard

SEED = 20261107_1  # new seed space (v0.1 used 20261106)
N = 1_000_000
SHARD = 20_000


def personas_dir() -> Path:
    p = default().output_root / "situations" / "personas"
    p.mkdir(parents=True, exist_ok=True)
    return p


def shard_path(k: int) -> Path:
    return personas_dir() / f"shard-{k:05d}.parquet"


async def gold_many(reqs: list[dict], url: str = GOLD_URL, concurrency: int = 64) -> list:
    """POST /gold for each request; returns trimmed gold or an error string per request."""
    sem = asyncio.Semaphore(concurrency)
    out: list = [None] * len(reqs)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(base_url=url, timeout=120, limits=limits) as client:

        async def one(i: int) -> None:
            async with sem:
                err = "unknown"
                for attempt in range(5):
                    try:
                        r = await client.post("/gold", json={"persona": reqs[i]})
                        if r.status_code == 200:
                            out[i] = trim(r.json())
                            return
                        err = f"{r.status_code}: {r.text[:200]}"
                        if r.status_code < 500:
                            break
                    except httpx.HTTPError as e:
                        err = repr(e)
                    await asyncio.sleep(0.5 * (attempt + 1))
                out[i] = err

        await asyncio.gather(*(one(i) for i in range(len(reqs))))
    return out


def to_record(row: dict) -> dict:
    return {
        "id": row["id"],
        "split": row["split"],
        "goal": row["goal"],
        "situation_text": row["situation_text"],
        "text_language": row["text_language"],
        "style": row["style"],
        "scenario": row["scenario"],
        "life_situation": row["life_situation"],
        "household": json.dumps(row["household"], ensure_ascii=False),
        "noise": json.dumps(row["noise"]),
        "gold": json.dumps(row["gold"], ensure_ascii=False),
        "gold_benefits": list(row["gold"]["benefits"]),
        "seed": SEED,
    }


def build_shard(k: int, n: int, seed: int, concurrency: int) -> dict:
    path = shard_path(k)
    if path.exists():
        return {"shard": k, "skipped": True}
    t0 = time.time()
    vocab = load_vocab(use_server=True)
    lo, hi = k * SHARD, min(n, (k + 1) * SHARD)
    rows: dict[int, dict | None] = {i: make_row(seed, i, n, vocab) for i in range(lo, hi)}
    stats: Counter = Counter(render_failed=sum(r is None for r in rows.values()))
    pending = [i for i, r in rows.items() if r is not None]
    errors: list[str] = []
    for _ in range(MAX_ATTEMPTS):
        if not pending:
            break
        golds = asyncio.run(
            gold_many([gold_request(rows[i]) for i in pending], concurrency=concurrency)
        )
        nxt = []
        for i, g in zip(pending, golds, strict=True):
            if isinstance(g, str):
                errors.append(g)
                rows[i]["gold"] = None
                continue
            rows[i]["gold"] = g
            if crosses_family(rows[i]["split"], g, vocab):
                stats["resampled_family_boundary"] += 1
                new = make_row(seed, i, n, vocab, rows[i]["_attempt"] + 1)
                if new is not None:
                    rows[i] = new
                    nxt.append(i)
        pending = nxt
    out = []
    for r in rows.values():
        if r is None or not r.get("gold") or crosses_family(r["split"], r["gold"], vocab):
            stats["dropped"] += 1
            continue
        r["gold"] = normalise_gold(r["gold"])
        out.append(to_record(r))
    write_shard(out, path)
    return {
        "shard": k,
        "rows": len(out),
        "errors": len(errors),
        "error_examples": errors[:3],
        "stats": dict(stats),
        "seconds": round(time.time() - t0, 1),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="1M engine-gold personas")
    ap.add_argument("--n", type=int, default=N)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--concurrency", type=int, default=48, help="gold requests per worker")
    ap.add_argument("--shards", type=str, default=None, help="e.g. 0-3 (default: all)")
    args = ap.parse_args(argv)
    if not server_up():
        print("research tool server is not up (GET /health)", file=sys.stderr)
        return 2
    n_shards = (args.n + SHARD - 1) // SHARD
    ks = list(range(n_shards))
    if args.shards:
        a, _, b = args.shards.partition("-")
        ks = list(range(int(a), int(b or a) + 1))
    print(
        json.dumps(
            {
                "n": args.n,
                "seed": args.seed,
                "shards": len(ks),
                "split_counts": split_counts(args.n),
            }
        ),
        flush=True,
    )
    t0 = time.time()
    summary = []
    with ProcessPoolExecutor(args.workers) as ex:
        futs = [ex.submit(build_shard, k, args.n, args.seed, args.concurrency) for k in ks]
        for f in as_completed(futs):
            r = f.result()
            summary.append(r)
            print(json.dumps(r), f"{time.time() - t0:.0f}s", flush=True)
    (personas_dir() / "summary.json").write_text(
        json.dumps(
            {
                "n": args.n,
                "seed": args.seed,
                "shard_size": SHARD,
                "shards": sorted(summary, key=lambda r: r["shard"]),
            },
            indent=1,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
