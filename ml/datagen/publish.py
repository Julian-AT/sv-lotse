"""`uv run python -m datagen.publish --family <name> [--version v0.2] [--dry-run]`

Uploads one family (= one Hugging Face config) of the AT-Benefits v1 release to the dataset repo
in config `hf_repo` (JulianAT/at-benefits). Each family builder writes its release to

    <output_root>/<family>/release/<split>/*.parquet   (zstd Parquet shards)
    <output_root>/<family>/release/card.md            (dataset-card section, markdown)
    <output_root>/<family>/release/metrics.json       (quality metrics)

and this command uploads them to `<family>/<split>/…parquet`, `<family>/metrics.json`, and merges
the card section into the repo README between `<!-- family:<name> -->` markers, registering the
config `<name>` with its splits in the README's YAML header. HF_TOKEN is read from .env.local via
python-dotenv and never printed. --dry-run prints the plan without network access.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml

from .config import default, load_env

FAMILIES = ("situations", "dialogues", "documents", "forms", "legal_qa")

HEADER = """# AT-Benefits

Open synthetic dataset for Austrian social-benefits navigation (SV KI-Lotse research lane):
situations, multi-turn dialogues, documents, forms and legal QA in German (incl. Austrian dialect
and plain language), English, Turkish, Bosnian/Croatian/Serbian, Romanian, Hungarian, Polish,
Ukrainian and Arabic. Labels (benefits, offices, documents, citations) are computed by the
SV KI-Lotse product engine, never by a language model; language models only write surface text,
which is checked for language, faithfulness, leakage and near-duplicates. No real person is
described. Labels are navigation hints, not eligibility decisions.
"""


def release_dir(family: str) -> Path:
    return default().output_root / family / "release"


def plan(family: str) -> dict:
    rel = release_dir(family)
    splits = {}
    for d in sorted(p for p in rel.iterdir() if p.is_dir()) if rel.exists() else []:
        shards = sorted(d.glob("*.parquet"))
        if shards:
            splits[d.name] = shards
    if not splits:
        sys.exit(f"no Parquet shards under {rel}/<split>/")
    return {"dir": rel, "splits": splits, "card": rel / "card.md", "metrics": rel / "metrics.json"}


def merge_readme(
    existing: str | None, family: str, splits: list[str], section: str, version: str
) -> str:
    meta: dict = {}
    body = HEADER
    if existing and existing.startswith("---"):
        _, fm, rest = existing.split("---", 2)
        meta = yaml.safe_load(fm) or {}
        body = rest.lstrip("\n")
    meta.setdefault("license", "cc-by-4.0")
    meta.setdefault("language", ["de", "en", "tr", "bs", "hr", "sr", "ro", "hu", "pl", "uk", "ar"])
    meta.setdefault("pretty_name", "AT-Benefits")
    meta.setdefault(
        "tags",
        [
            "synthetic",
            "social-insurance",
            "austria",
            "benefits-navigation",
            "multilingual",
            "agents",
        ],
    )
    configs = [c for c in meta.get("configs", []) if c.get("config_name") != family]
    configs.append(
        {
            "config_name": family,
            "data_files": [{"split": s, "path": f"{family}/{s}/*.parquet"} for s in splits],
        }
    )
    meta["configs"] = sorted(
        configs,
        key=lambda c: FAMILIES.index(c["config_name"]) if c["config_name"] in FAMILIES else 99,
    )
    start, end = f"<!-- family:{family} -->", f"<!-- /family:{family} -->"
    block = f"{start}\n{section.strip()}\n\n_Release {version}._\n{end}"
    if start in body:
        body = re.sub(re.escape(start) + r".*?" + re.escape(end), lambda _: block, body, flags=re.S)
    else:
        body = body.rstrip() + "\n\n" + block + "\n"
    return "---\n" + yaml.safe_dump(meta, sort_keys=False, allow_unicode=True) + "---\n\n" + body


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Publish one AT-Benefits family to Hugging Face")
    ap.add_argument("--family", required=True, choices=FAMILIES)
    ap.add_argument("--version", default=None)
    ap.add_argument("--repo", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="datagen output root (default: config output_root, i.e. the main "
        "checkout's ml/data/datagen; DATAGEN_ROOT also works)",
    )
    args = ap.parse_args(argv)
    if args.data_root:
        os.environ["DATAGEN_ROOT"] = str(args.data_root.resolve())
    cfg = default()
    version = args.version or cfg.version
    repo = args.repo or cfg.hf_repo
    p = plan(args.family)
    section = p["card"].read_text() if p["card"].exists() else f"## {args.family}\n"
    files = [(s, f) for s, shards in p["splits"].items() for f in shards]
    print(
        f"{repo} config={args.family} version={version}: "
        + ", ".join(f"{s}={len(v)} shards" for s, v in p["splits"].items())
    )
    if args.dry_run:
        print(merge_readme(None, args.family, list(p["splits"]), section, version)[:2000])
        return
    load_env()
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN missing in .env.local")
    from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download

    api = HfApi(token=token)
    api.create_repo(repo, repo_type="dataset", exist_ok=True)
    try:
        existing = Path(
            hf_hub_download(repo, "README.md", repo_type="dataset", token=token)
        ).read_text()
    except Exception:  # noqa: BLE001 - first upload: no README yet
        existing = None
    readme = merge_readme(existing, args.family, list(p["splits"]), section, version)
    ops = [CommitOperationAdd(f"{args.family}/{s}/{f.name}", str(f)) for s, f in files]
    if p["metrics"].exists():
        ops.append(CommitOperationAdd(f"{args.family}/metrics.json", str(p["metrics"])))
    for extra in sorted(p["dir"].glob("*.jsonl")):  # e.g. spotcheck.jsonl
        ops.append(CommitOperationAdd(f"{args.family}/{extra.name}", str(extra)))
    ops.append(CommitOperationAdd("README.md", readme.encode()))
    # Remove shards of this family that are no longer part of the release.
    from huggingface_hub import CommitOperationDelete

    keep = {f"{args.family}/{s}/{f.name}" for s, f in files}
    for path in api.list_repo_files(repo, repo_type="dataset"):
        if path.startswith(f"{args.family}/") and path.endswith(".parquet") and path not in keep:
            ops.append(CommitOperationDelete(path))
    info = api.create_commit(
        repo, ops, repo_type="dataset", commit_message=f"{args.family} {version}"
    )
    try:
        api.create_tag(repo, tag=f"{version}-{args.family}", repo_type="dataset", exist_ok=True)
    except Exception as e:  # noqa: BLE001
        print(f"tag skipped: {type(e).__name__}")
    print(json.dumps({"repo": repo, "family": args.family, "commit": info.oid, "files": len(ops)}))


if __name__ == "__main__":
    main()
