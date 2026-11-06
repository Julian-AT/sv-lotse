"""OpenAI-style function definitions for the gym.

Names follow the product gateway (``lotse_<tool with dots as underscores>``). When the research
server publishes JSON schemas at ``GET /tools`` those are used; otherwise the fallback schemas below
mirror the Zod contracts in packages/brain/src/tools/contracts/index.ts for the tools the gym uses.
"""

from __future__ import annotations

from typing import Any

from gym.paths import wire_name

_str = {"type": "string"}

FALLBACK_SCHEMAS: dict[str, tuple[str, dict[str, Any]]] = {
    "catalog.findBenefits": (
        "Find administrative benefits and sourced eligibility criteria. Copy a returned item's id "
        "verbatim into benefitId for subsequent tools.",
        {
            "type": "object",
            "properties": {
                "lifeSituation": _str,
                "goalText": _str,
                "subject": {
                    "type": "object",
                    "properties": {
                        "ageBand": _str,
                        "carrier": _str,
                        "region": _str,
                        "status": _str,
                    },
                    "additionalProperties": False,
                },
            },
            "required": ["goalText", "subject"],
            "additionalProperties": False,
        },
    ),
    "catalog.getBenefit": (
        "Read a sourced benefit record.",
        {
            "type": "object",
            "properties": {"benefitId": _str},
            "required": ["benefitId"],
            "additionalProperties": False,
        },
    ),
    "office.resolve": (
        "Resolve catalog office rules using carrier, explicit subject status (pensioner:<pension "
        "carrier> where known) and region. OFFICE_CONTEXT_REQUIRED means ask; never guess.",
        {
            "type": "object",
            "properties": {
                "benefitId": _str,
                "carrier": _str,
                "subjectStatus": _str,
                "region": _str,
            },
            "required": ["benefitId", "carrier", "subjectStatus", "region"],
            "additionalProperties": False,
        },
    ),
    "documents.checklist": (
        "List required administrative documents and how to obtain them.",
        {
            "type": "object",
            "properties": {"benefitId": _str, "subjectId": _str},
            "required": ["benefitId", "subjectId"],
            "additionalProperties": False,
        },
    ),
    "kb.search": (
        "Retrieve sourced administrative passages.",
        {
            "type": "object",
            "properties": {
                "query": _str,
                "filters": {
                    "type": "object",
                    "properties": {"carrier": _str, "region": _str, "area": _str, "asOf": _str},
                    "additionalProperties": False,
                },
                "k": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["query", "filters", "k"],
            "additionalProperties": False,
        },
    ),
}

SUBMIT_PLAN = "submit_plan"
SUBMIT_PLAN_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": SUBMIT_PLAN,
        "description": (
            "Submit the final plan. Every benefit must be backed by citations returned by tools."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "benefits": {"type": "array", "items": _str},
                "office_per_benefit": {"type": "object", "additionalProperties": _str},
                "documents_per_benefit": {
                    "type": "object",
                    "additionalProperties": {"type": "array", "items": _str},
                },
                "next_step": {
                    "type": "object",
                    "properties": {"benefitId": _str, "stepId": _str, "description": _str},
                },
                "citations": {"type": "array", "items": _str},
            },
            "required": [
                "benefits",
                "office_per_benefit",
                "documents_per_benefit",
                "next_step",
                "citations",
            ],
        },
    },
}


def function_defs(server_schemas: Any | None = None, names: list[str] | None = None) -> list[dict]:
    """Function definitions for the engine tools plus ``submit_plan``."""
    defs: list[dict[str, Any]] = []
    published: dict[str, dict[str, Any]] = {}
    if isinstance(server_schemas, list):
        published = {s["name"]: s for s in server_schemas if isinstance(s, dict) and "name" in s}
    elif isinstance(server_schemas, dict):
        published = {k: v for k, v in server_schemas.items() if isinstance(v, dict)}
    for name in names or list(FALLBACK_SCHEMAS):
        if name in published:
            entry = published[name]
            description = entry.get("description", "")
            params = entry.get("input") or entry.get("inputSchema") or entry.get("parameters")
        else:
            description, params = FALLBACK_SCHEMAS[name]
        defs.append(
            {
                "type": "function",
                "function": {
                    "name": wire_name(name),
                    "description": description,
                    "parameters": params,
                },
            }
        )
    defs.append(SUBMIT_PLAN_SCHEMA)
    return defs
