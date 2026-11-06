"""Read-only views of product knowledge data used by the gym (packages/knowledge)."""

from __future__ import annotations

import json
from functools import cache
from typing import Any

import yaml

from gym.paths import REPO_DIR

KNOWLEDGE = REPO_DIR / "packages" / "knowledge"


@cache
def processes() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for path in sorted((KNOWLEDGE / "processes").glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and data.get("id"):
            out[str(data["id"])] = data
    return out


def process_benefit(process_id: str | None) -> str | None:
    """Catalog benefit id of a process (``benefit: ref:catalog/<id>``)."""
    ref = str((processes().get(process_id or "") or {}).get("benefit") or "")
    return ref.removeprefix("ref:catalog/") or None


@cache
def slot_hints() -> dict[str, str]:
    """Engine slot id -> German question hint (first definition wins)."""
    hints: dict[str, str] = {}
    for definition in processes().values():
        for slot in definition.get("slots") or []:
            if slot.get("id") and slot.get("question_hint"):
                hints.setdefault(str(slot["id"]), str(slot["question_hint"]))
    return hints


def hint_for(process_id: str | None, slot_id: str) -> str | None:
    for slot in (processes().get(process_id or "") or {}).get("slots") or []:
        if slot.get("id") == slot_id and slot.get("question_hint"):
            return str(slot["question_hint"])
    return slot_hints().get(slot_id)


@cache
def office_context() -> dict[str, Any]:
    return json.loads((KNOWLEDGE / "data" / "office-context.json").read_text(encoding="utf-8"))


def carrier_value(value: str) -> str:
    lower = value.lower()
    return office_context()["carrier_aliases"].get(lower, lower)


def office_status(status: str | None, pension_carrier: str | None) -> str:
    """Mirror of the engine's office status: ``pensioner:<carrier>`` when the pension carrier is
    known, else the lower-cased insurance status."""
    status_l = (status or "").lower()
    if pension_carrier and (not status_l or status_l == "pensioner"):
        return f"pensioner:{carrier_value(pension_carrier)}"
    return status_l
