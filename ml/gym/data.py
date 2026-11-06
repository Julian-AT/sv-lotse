"""Persona loading: a directory of ``*.jsonl``/``*.json`` files or one JSONL file (§5.2 schema)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any


def _iter_file(path: Path) -> Iterator[dict[str, Any]]:
    if path.suffix == ".jsonl":
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    yield json.loads(line)
    elif path.suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            yield from data
        elif isinstance(data, dict) and "household" in data:
            yield data


def iter_personas(path: str | Path, split: str | None = None) -> Iterator[dict[str, Any]]:
    root = Path(path)
    files = (
        sorted(p for p in root.rglob("*") if p.suffix in (".jsonl", ".json"))
        if root.is_dir()
        else [root]
    )
    for file in files:
        for persona in _iter_file(file):
            if split is None or persona.get("split") == split:
                yield persona


def load_personas(path: str | Path, split: str | None = None, n: int | None = None) -> list[dict]:
    out: list[dict[str, Any]] = []
    for persona in iter_personas(path, split):
        out.append(persona)
        if n is not None and len(out) >= n:
            break
    return out
