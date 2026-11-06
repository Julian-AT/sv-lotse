"""Publish the AT-Benefits personas to Hugging Face (`python -m publish.personas`).

Uploads the Parquet splits, the dataset card (ml/personas/README.md) and the validation report to
`${HF_USERNAME}/at-benefits-personas`. HF_TOKEN and HF_USERNAME are loaded at runtime from the
repository's `.env.local` (or the environment); the token is never printed. Publishing is refused
unless the latest validation report passed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ML = Path(__file__).resolve().parents[1]
DATA = ML / "data" / "personas"
CARD = ML / "personas" / "README.md"
RESULTS = ML / "results"
SPLITS = ("train", "val", "test", "heldout_family")


def credentials(env_file: Path | None) -> tuple[str, str]:
    path = env_file or ML.parent / ".env.local"
    if path.exists():
        load_dotenv(path, override=False)
    token, user = os.environ.get("HF_TOKEN"), os.environ.get("HF_USERNAME")
    if not token:
        sys.exit("HF_TOKEN missing: the owner must add HF_TOKEN (and HF_USERNAME) to .env.local")
    if not user:
        # Same fallback as publish.corpus: the namespace of the account that owns the token.
        from huggingface_hub import HfApi

        user = HfApi(token=token).whoami()["name"]
        print(f"HF_USERNAME not set, using the token owner: {user}", file=sys.stderr)
    return token, user


def latest_report(report: Path | None) -> tuple[Path, dict]:
    if report is None:
        reports = sorted(RESULTS.glob("personas-*.json"), key=lambda p: p.stat().st_mtime)
        if not reports:
            sys.exit("no validation report in ml/results; run python -m personas.validate first")
        report = reports[-1]
    return report, json.loads(report.read_text())


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--env-file", type=Path, default=None)
    ap.add_argument("--repo-name", default="at-benefits-personas")
    ap.add_argument("--report", type=Path, default=None)
    ap.add_argument("--private", action="store_true")
    args = ap.parse_args(argv)

    report_path, report = latest_report(args.report)
    if not report["checks"].get("passed"):
        sys.exit(f"refusing to publish: {report_path.name} did not pass validation")
    leak = report.get("leakage")
    if leak is not None and not leak.get("passed"):
        sys.exit(f"refusing to publish: leakage test failed in {report_path.name}")
    files = {f"data/{s}.parquet": DATA / f"{s}.parquet" for s in SPLITS}
    for local in files.values():
        if not local.exists():
            sys.exit(f"missing {local}")
        sha = report["files"].get(local.name, {}).get("sha256")
        from personas.validate import sha256

        if sha != sha256(local):
            sys.exit(f"refusing to publish: {local.name} differs from the validated file")

    token, user = credentials(args.env_file)
    from huggingface_hub import CommitOperationAdd, HfApi

    repo_id = f"{user}/{args.repo_name}"
    api = HfApi(token=token)
    api.create_repo(repo_id, repo_type="dataset", private=args.private, exist_ok=True)
    ops = [CommitOperationAdd(path_in_repo=k, path_or_fileobj=str(v)) for k, v in files.items()]
    ops.append(CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=str(CARD)))
    ops.append(CommitOperationAdd(path_in_repo="validation.json", path_or_fileobj=str(report_path)))
    counts = {s: report["splits"][s]["n"] for s in SPLITS}
    info = api.create_commit(
        repo_id=repo_id,
        repo_type="dataset",
        operations=ops,
        commit_message=f"Add personas {counts} (validated by {report_path.name})",
    )
    url = f"https://huggingface.co/datasets/{repo_id}"
    record = {
        "dataset": repo_id,
        "url": url,
        "published_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "hf_commit": getattr(info, "oid", None),
        "split_counts": counts,
        "validation_report": report_path.name,
        "git_sha": report.get("git_sha"),
        "files": {k: report["files"][Path(k).name] for k in files},
        "leakage": leak,
        "licence": "cc-by-4.0",
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "publish-personas.json").write_text(json.dumps(record, indent=2))
    print(url)


if __name__ == "__main__":
    main()
