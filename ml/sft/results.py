"""Run records: every run writes ml/results/<run>.json with config, data hash, git SHA, metrics."""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path
from typing import Any

ML_ROOT = Path(__file__).resolve().parents[1]
RESULTS_DIR = ML_ROOT / "results"


def git_sha(short: bool = True) -> str:
    """Git SHA of the checkout; falls back to the GIT_SHA file written by the remote sync."""
    try:
        args = ["git", "rev-parse", *(["--short"] if short else []), "HEAD"]
        out = subprocess.run(args, cwd=ML_ROOT, capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        marker = ML_ROOT / "GIT_SHA"
        return marker.read_text().strip() if marker.exists() else "unknown"


def file_hash(*paths: Path | str) -> str:
    """sha256 over the bytes of the given files (sorted, directories expanded)."""
    digest = hashlib.sha256()
    files: list[Path] = []
    for p in map(Path, paths):
        files.extend(sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p])
    for f in sorted(files):
        digest.update(f.name.encode())
        with f.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def write_result(run: str, record: dict[str, Any], out_dir: Path | None = None) -> Path:
    out = (out_dir or RESULTS_DIR) / f"{run}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    base = {
        "run": run,
        "git_sha": git_sha(),
        "written_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "host": platform.node(),
        "python": platform.python_version(),
    }
    out.write_text(json.dumps({**base, **record}, indent=2, ensure_ascii=False) + "\n")
    return out
