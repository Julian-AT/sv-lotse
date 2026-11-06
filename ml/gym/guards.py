"""Boundary detection with the product's rule patterns.

Patterns: packages/knowledge/guards/boundary-rules.yaml.

The brain compiles each pattern with the JavaScript flags ``iu`` and tests the NFKC-normalized
assistant text (packages/brain/src/guards/rules.ts). We do the same with Python's ``re``;
the wording lives only in the YAML.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import cache

import yaml

from gym.paths import GUARDS_DIR


@dataclass(frozen=True)
class BoundaryRule:
    id: str
    category: str
    expression: re.Pattern[str]


@cache
def boundary_rules() -> tuple[str, tuple[BoundaryRule, ...]]:
    data = yaml.safe_load((GUARDS_DIR / "boundary-rules.yaml").read_text(encoding="utf-8"))
    rules = tuple(
        BoundaryRule(
            id=item["id"],
            category=item["category"],
            expression=re.compile(item["pattern"], re.IGNORECASE | re.UNICODE),
        )
        for item in data["patterns"]
    )
    return str(data["version"]), rules


def check_boundary(text: str) -> list[dict[str, str]]:
    """Return the violated rule ids for one assistant utterance (empty list when clean)."""
    normalized = unicodedata.normalize("NFKC", text)
    _, rules = boundary_rules()
    return [
        {"patternId": rule.id, "category": rule.category}
        for rule in rules
        if rule.expression.search(normalized)
    ]
