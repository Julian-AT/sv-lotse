"""Fake model for tests and dry runs: answers each request with valid content for its spec."""

from __future__ import annotations

import json
import re

from .content import fake_content
from .spec import DocSpec

_SPECS: dict[str, DocSpec] = {}


def register(spec: DocSpec) -> None:
    _SPECS[spec.reference] = spec


def responder(body: dict) -> str:
    """Find the spec by its reference in the prompt; specs are registered by `build_spec`
    callers through `register`, or reconstructed from the prompt's JSON facts."""
    rf = (body.get("response_format") or {}).get("json_schema") or {}
    if rf.get("name") == "Judgement":
        crit = ["realism", "consistency", "boundary", "german", "gold"]
        return json.dumps(
            {
                "scores": [{"criterion": c, "score": 5} for c in crit],
                "passed": True,
                "reason": "fake",
            }
        )
    user = body["messages"][-1]["content"]
    m = re.search(r'"reference": "([^"]+)"', user)
    if m:
        ref = m.group(1).split(" ", 1)[-1]
        for key, spec in list(_SPECS.items()):
            if key == ref or ref.endswith(key):
                return json.dumps(fake_content(spec), ensure_ascii=False)
    return json.dumps({"sections": []})
