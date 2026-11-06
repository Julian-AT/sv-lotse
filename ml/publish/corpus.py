"""Publish the RIS-only corpus to Hugging Face (`python -m publish.corpus`).

HF_TOKEN and HF_USERNAME are read from the repository's `.env.local` at runtime (or from the
environment). The token is never printed. Only RIS data is uploaded: the local SozDok join file
is refused explicitly.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

ML = Path(__file__).resolve().parents[1]
DATA = ML / "data" / "corpus"
CARD = ML / "corpus" / "README.md"
RESULTS = ML / "results"


def credentials(env_file: Path | None) -> tuple[str, str]:
    candidates = [env_file] if env_file else [ML.parent / ".env.local"]
    for path in candidates:
        if path and path.exists():
            load_dotenv(path, override=False)
    token, user = os.environ.get("HF_TOKEN"), os.environ.get("HF_USERNAME")
    if not token:
        sys.exit("HF_TOKEN missing: the owner must add HF_TOKEN (and HF_USERNAME) to .env.local")
    if not user:
        # fall back to the account that owns the token
        from huggingface_hub import HfApi

        user = HfApi(token=token).whoami()["name"]
        print(f"HF_USERNAME not set, using token owner: {user}", file=sys.stderr)
    return token, user


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--repo-name", default="at-sv-law")
    ap.add_argument("--private", action="store_true")
    args = ap.parse_args(argv)

    from huggingface_hub import HfApi

    parquet = DATA / "at-sv-law.parquet"
    stats_file = DATA / "stats.json"
    df = pd.read_parquet(parquet)
    if set(df["source"]) != {"RIS"} or any("sozdok" in c.lower() for c in df.columns):
        sys.exit("refusing to publish: corpus contains non-RIS data")

    token, user = credentials(args.env_file)
    repo_id = f"{user}/{args.repo_name}"
    api = HfApi(token=token)
    api.create_repo(repo_id, repo_type="dataset", private=args.private, exist_ok=True)
    msg = f"Add RIS corpus ({len(df)} records, as of {df['version_as_of'].iloc[0]})"
    api.upload_file(
        path_or_fileobj=str(parquet),
        path_in_repo="data/train.parquet",
        repo_id=repo_id,
        repo_type="dataset",
        commit_message=msg,
    )
    api.upload_file(
        path_or_fileobj=str(stats_file),
        path_in_repo="stats.json",
        repo_id=repo_id,
        repo_type="dataset",
        commit_message="Add build statistics",
    )
    info = api.upload_file(
        path_or_fileobj=str(CARD),
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="dataset",
        commit_message="Add dataset card",
    )
    stats = json.loads(stats_file.read_text())
    url = f"https://huggingface.co/datasets/{repo_id}"
    record = {
        "dataset": repo_id,
        "url": url,
        "published_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "hf_commit": getattr(info, "oid", None),
        "records": len(df),
        "complete": stats.get("complete"),
        "git_sha": stats.get("git_sha"),
        "parquet_sha256": stats.get("parquet_sha256"),
        "licence": stats.get("licence"),
        "contains_sozdok": False,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "publish-corpus.json").write_text(json.dumps(record, indent=2))
    print(url)


if __name__ == "__main__":
    main()
