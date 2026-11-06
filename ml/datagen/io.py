"""Release layout helpers shared by the family builders (see datagen.publish)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .config import ML, default


def family_dir(family: str) -> Path:
    p = default().output_root / family
    p.mkdir(parents=True, exist_ok=True)
    return p


def release_dir(family: str) -> Path:
    p = family_dir(family) / "release"
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_shard(rows: list[dict], path: Path, schema: pa.Schema | None = None) -> Path:
    """Write rows as one zstd Parquet file (atomic rename). Nested dicts/lists are kept as
    Arrow structs/lists unless the caller JSON-encodes them first."""
    path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(rows, schema=schema)
    tmp = path.with_suffix(".tmp")
    pq.write_table(table, tmp, compression="zstd", compression_level=9)
    tmp.replace(path)
    return path


def write_release_shard(
    family: str, split: str, index: int, rows: list[dict], schema: pa.Schema | None = None
) -> Path:
    return write_shard(rows, release_dir(family) / split / f"{split}-{index:05d}.parquet", schema)


def write_card(family: str, markdown: str, directory: Path | None = None) -> Path:
    p = (directory or release_dir(family)) / "card.md"
    p.write_text(markdown)
    return p


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short=8", "HEAD"], cwd=ML, text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "nogit"


def write_metrics(family: str, metrics: dict, directory: Path | None = None) -> tuple[Path, Path]:
    """Writes <release>/metrics.json and ml/results/datagen-<family>-<sha>.json."""
    data = json.dumps(metrics, indent=2, ensure_ascii=False, default=str)
    a = (directory or release_dir(family)) / "metrics.json"
    a.write_text(data)
    b = ML / "results" / f"datagen-{family}-{git_sha()}.json"
    b.write_text(data)
    return a, b


def disk_usage_gb() -> float:
    root = default().output_root
    return sum(f.stat().st_size for f in root.rglob("*") if f.is_file()) / 1e9


def swap_release(family: str, staged: Path) -> Path:
    """Atomically replace <family>/release with a fully built staging directory."""
    import shutil

    rel = family_dir(family) / "release"
    old = family_dir(family) / "release-old"
    if old.exists():
        shutil.rmtree(old)
    if rel.exists():
        rel.rename(old)
    staged.rename(rel)
    if old.exists():
        shutil.rmtree(old)
    return rel
