"""Repository paths used by the gym. Product data is read in place, never copied."""

from __future__ import annotations

import re
import subprocess
from functools import cache
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = ML_DIR.parent
GUARDS_DIR = REPO_DIR / "packages" / "knowledge" / "guards"
CONTRACTS_FILE = REPO_DIR / "packages" / "brain" / "src" / "tools" / "contracts" / "index.ts"
RESULTS_DIR = ML_DIR / "results"
DATA_DIR = ML_DIR / "data"

DEFAULT_SERVER = "http://127.0.0.1:4317"


@cache
def tool_names() -> frozenset[str]:
    """Tool names declared in the brain's Zod contract map (`contracts` in index.ts)."""
    text = CONTRACTS_FILE.read_text(encoding="utf-8")
    body = text.split("export const contracts = {", 1)[1]
    return frozenset(re.findall(r'^  "([A-Za-z]+\.[A-Za-z]+)": ', body, flags=re.MULTILINE))


def wire_name(name: str) -> str:
    """Function name the gateway exposes to models (brain src/models/tool-names.ts)."""
    return f"lotse_{name.replace('.', '_')}"


def from_wire_name(wire: str) -> str | None:
    for name in tool_names():
        if wire_name(name) == wire:
            return name
    return None


@cache
def git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_DIR,
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
