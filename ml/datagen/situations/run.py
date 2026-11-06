"""Situations runner: `uv run python -m datagen.situations.run --tranche 1 [--steps …]`.

Steps (default all, resumable):
  personas   1,000,000 engine-gold personas (no LLM; datagen.situations.personas)
  natural    LLM naturalisation in chunks until the situations token share is spent; only after
             datagen.check_key returns OK; stops cleanly on BudgetExceeded / QuotaError
  release    release Parquet (train/validation/test/heldout_family), card, metrics, leakage test
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import pandas as pd

from .. import check_key
from .. import quality as q
from ..config import default
from ..ledger import BudgetExceeded
from ..llm import LLM, QuotaError
from . import naturalize as nat
from . import personas as P
from .release import build_release

CHUNK = 100  # keep fixed: chunk k covers queue[k*CHUNK:(k+1)*CHUNK] across resumes
TOKENS_PER_ITEM = 1600  # worst case per persona incl. judge share; stop below one chunk of it


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def existing_chunks() -> dict[int, pd.DataFrame]:
    out = {}
    for f in sorted(nat.natural_dir().glob("chunk-*.parquet")):
        out[int(f.stem.split("-")[1])] = pd.read_parquet(f)
    return out


def run_natural(tranche: int, max_chunks: int | None) -> dict:
    ok, msg = check_key.check()
    log(f"check_key: {msg}")
    if not ok:
        return {"started": False, "reason": msg}
    llm = LLM("situations", max_retries=8)
    queue = nat.build_queue()
    done = existing_chunks()
    dedup = q.NearDup()
    for df in done.values():
        for _, r in df[df["accepted"]].iterrows():
            dedup.add(r["id"], r["text"])
    ctx = nat.Context()
    n_chunks = (len(queue) + CHUNK - 1) // CHUNK
    ran, stop = 0, None
    k = -1
    while k + 1 < n_chunks:
        k += 1
        if k in done:
            continue
        if max_chunks is not None and ran >= max_chunks:
            stop = "max_chunks"
            break
        rem = llm.remaining()
        if rem["family"] < CHUNK * TOKENS_PER_ITEM or rem["total"] < CHUNK * TOKENS_PER_ITEM:
            stop = f"budget share reached (remaining {rem})"
            break
        ids = queue["id"].iloc[k * CHUNK : (k + 1) * CHUNK].tolist()
        try:
            r = nat.process_chunk(k, ids, llm, ctx, dedup)
        except BudgetExceeded as e:
            stop = f"budget: {e}"
            break
        except QuotaError as e:
            stop = f"quota: {e}"
            break
        ran += 1
        log(json.dumps({**r, "remaining": llm.remaining()}))
        if r["stopped"] == "transient":
            log("transient backend errors: chunk will be redone; backing off 120 s")
            time.sleep(120)
            k -= 1  # redo the same chunk
            continue
        if r["stopped"]:
            stop = r["stopped"]
            break
    return {
        "started": True,
        "tranche": tranche,
        "chunks_run": ran,
        "stop": stop,
        "remaining": llm.remaining(),
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="situations family runner")
    ap.add_argument("--tranche", type=int, default=1)
    ap.add_argument("--steps", default="personas,natural,release")
    ap.add_argument("--max-chunks", type=int, default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--chunk", type=int, default=CHUNK)
    args = ap.parse_args(argv)
    steps = args.steps.split(",")
    status: dict = {}
    if "personas" in steps:
        rc = P.main(["--workers", str(args.workers)])
        if rc:
            return rc
    globals()["CHUNK"] = args.chunk
    if "natural" in steps:
        status = run_natural(args.tranche, args.max_chunks)
        log(json.dumps(status))
        (nat.natural_dir() / f"tranche-{args.tranche}.json").write_text(json.dumps(status))
    if "release" in steps:
        m = build_release()
        log(json.dumps({k: m[k] for k in ("counts", "natural") if k in m}, default=str)[:2000])
    disk = sum(f.stat().st_size for f in default().output_root.rglob("*") if f.is_file()) / 1e9
    log(f"disk {disk:.2f} GB under {default().output_root}")
    return 0 if status.get("started", True) or "natural" not in steps else 0


if __name__ == "__main__":
    sys.exit(main())
