"""`uv run python -m datagen.models`: list backend models and validate the configured roles."""

from __future__ import annotations

import json

from . import pricing
from .config import default
from .transport import OpenAITransport, TransportError


def validate(transport=None) -> dict:
    cfg = default()
    roles = {r: cfg.role(r)["model"] for r in cfg.raw["models"]}
    try:
        available = (transport or OpenAITransport()).list_models()
    except TransportError as e:
        return {"ok": False, "error": str(e), "roles": roles}
    report = {
        "ok": True,
        "roles": {
            r: {"model": m, "available": m in available, "list_price": pricing.known(m)}
            for r, m in roles.items()
        },
        "available": [m for m in available if "/" not in m],
    }
    report["ok"] = all(v["available"] for v in report["roles"].values()) if available else True
    return report


if __name__ == "__main__":
    print(json.dumps(validate(), indent=2))
