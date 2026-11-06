"""Build the Austrian social-insurance law corpus from RIS (`python -m corpus.build --acts sv`)."""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd

from corpus import sozdok
from corpus.acts import Act, resolve
from corpus.parse import paragraph_key, parse_document, reference_meta, search_hits
from corpus.ris import RisClient

ML = Path(__file__).resolve().parents[1]
DATA = ML / "data" / "corpus"
RESULTS = ML / "results"
LICENCE = "CC-BY-4.0"
ATTRIBUTION = "Datenquelle: Rechtsinformationssystem des Bundes (RIS), Bundeskanzleramt Österreich"


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=ML, text=True
        ).strip()
    except Exception:
        return "nogit"


async def list_refs(client: RisClient, act: Act, as_of: str) -> list[dict]:
    params = {"Applikation": "BrKons", "Gesetzesnummer": act.gesetzesnummer}
    if act.in_force:
        params["Fassung.FassungVom"] = as_of
    first = await client.search_page(params, 1)
    total, refs = search_hits(first)
    pages = (total + 99) // 100
    rest = await asyncio.gather(*(client.search_page(params, p) for p in range(2, pages + 1)))
    for payload in rest:
        refs.extend(search_hits(payload)[1])
    metas = [reference_meta(r) for r in refs]
    if not act.in_force:
        # repealed act: keep the last consolidated version of each paragraph
        latest: dict[str, dict] = {}
        for m in metas:
            k = m["paragraph"]
            if k not in latest or (m["valid_from"] or "") > (latest[k]["valid_from"] or ""):
                latest[k] = m
        metas = list(latest.values())
    return metas


async def fetch_text(client: RisClient, meta: dict) -> dict:
    if not meta["xml_url"]:
        return {**meta, "section": "", "title": "", "text": ""}
    raw = await client.get(meta["xml_url"], suffix=".xml")
    try:
        parsed = parse_document(raw)
    except Exception as exc:  # malformed upstream XML: keep the record, flag it
        print(f"  parse error {meta['doc_id']}: {exc}", file=sys.stderr)
        parsed = {"section": "", "title": "", "text": ""}
    return {**meta, **parsed}


async def crawl(acts: list[Act], as_of: str, deadline: float | None) -> tuple[list[dict], dict]:
    client = RisClient(DATA / "raw")
    records: list[dict] = []
    coverage: dict[str, dict] = {}
    try:
        for act in acts:
            metas = await list_refs(client, act, as_of)
            done: list[dict] = []
            batch = 40
            for i in range(0, len(metas), batch):
                if deadline and time.time() > deadline:
                    break
                done.extend(
                    await asyncio.gather(*(fetch_text(client, m) for m in metas[i : i + batch]))
                )
            coverage[act.abbr] = {"listed": len(metas), "fetched": len(done)}
            print(f"{act.abbr}: {len(done)}/{len(metas)} documents", file=sys.stderr)
            for r in done:
                r["act"] = act.abbr
            records.extend(done)
    finally:
        await client.close()
    print(f"http fetched={client.fetched} cached={client.cached}", file=sys.stderr)
    return records, coverage


def to_frame(records: list[dict], as_of: str) -> pd.DataFrame:
    df = pd.DataFrame(records)
    # `§ 0` Norm records only carry the act's long title (no normative text)
    df = df[df["text"] != ""].copy()
    df["paragraph_key"] = df["paragraph"].map(paragraph_key)
    df["source"] = "RIS"
    df["licence"] = LICENCE
    df["attribution"] = ATTRIBUTION
    df["version_as_of"] = as_of
    df["text_sha256"] = df["text"].map(lambda t: hashlib.sha256(t.encode()).hexdigest())
    cols = [
        "doc_id", "act", "act_title", "gesetzesnummer", "paragraph", "paragraph_key",
        "norm_type", "doc_type",
        "section", "title", "text", "valid_from", "valid_to", "promulgation", "changed",
        "version_as_of", "url", "xml_url", "source", "licence", "attribution", "text_sha256",
    ]  # fmt: skip
    df = df[cols].sort_values(["act", "doc_id"]).reset_index(drop=True)
    return df


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--acts", default="sv", help="`sv` or comma-separated abbreviations")
    ap.add_argument("--as-of", default=dt.date.today().isoformat(), help="consolidation date")
    ap.add_argument("--deadline", default=None, help="stop fetching at HH:MM local time")
    ap.add_argument("--sozdok", default=None, help="local SV-Box Rechtstexte dir (never published)")
    args = ap.parse_args(argv)

    deadline = None
    if args.deadline:
        h, m = map(int, args.deadline.split(":"))
        deadline = dt.datetime.now().replace(hour=h, minute=m, second=0).timestamp()

    acts = resolve(args.acts)
    records, coverage = asyncio.run(crawl(acts, args.as_of, deadline))
    df = to_frame(records, args.as_of)
    DATA.mkdir(parents=True, exist_ok=True)
    out = DATA / "at-sv-law.parquet"
    df.to_parquet(out, compression="zstd", index=False)

    local = None
    if args.sozdok:
        local = sozdok.join(df, Path(args.sozdok), DATA / "at-sv-law.sozdok-local.parquet")

    sha = git_sha()
    stats = {
        "dataset": "at-sv-law",
        "built_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "git_sha": sha,
        "version_as_of": args.as_of,
        "source": "RIS OGD API v2.6 (Bundesrecht konsolidiert)",
        "licence": LICENCE,
        "attribution": ATTRIBUTION,
        "records": len(df),
        "empty_text": int((df["text"] == "").sum()),
        "chars": int(df["text"].str.len().sum()),
        "tokens_estimate": int(df["text"].str.split().str.len().sum() * 1.6),
        "per_act": {
            act: {
                "records": int(len(g)),
                "chars": int(g["text"].str.len().sum()),
                "tokens_estimate": int(g["text"].str.split().str.len().sum() * 1.6),
                **coverage.get(act, {}),
            }
            for act, g in df.groupby("act")
        },
        "complete": all(c["listed"] == c["fetched"] for c in coverage.values()),
        "parquet_sha256": file_sha256(out),
        "content_sha256": hashlib.sha256("".join(df["text_sha256"]).encode()).hexdigest(),
        "sozdok_local_join": local,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"corpus-{sha}.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    (DATA / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False))
    print(json.dumps({k: stats[k] for k in ("records", "tokens_estimate", "complete")}))


if __name__ == "__main__":
    main()
