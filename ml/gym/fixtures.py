"""A hand-written §5.2 persona and a fake tool server for offline tests and the selftest.

The fake outputs only follow the shapes of the brain contracts; they carry no real catalog data.
"""

from __future__ import annotations

import copy
from typing import Any

from gym.transport import FakeTransport, ToolResult

SRC_PG = "https://example.test/sources/pflegegeld"
SRC_PB = "https://example.test/sources/pflegeberatung"

PERSONA: dict[str, Any] = {
    "id": "p-fixture-1",
    "split": "train",
    "household": [
        {
            "role": "subject",
            "age": 74,
            "sex": "f",
            "residence": {"state": "Steiermark", "district": "Graz"},
            "insurance": {"carrier": "OEGK", "status": "pensioner", "pension_carrier": "PVA"},
            "employment": "retired",
            "income_band": "lt_1300",
            "care": {"pflegegeld_level": None, "needs": ["mobility", "household"]},
            "children": [],
            "documents_held": ["discharge_letter", "e_card"],
            "language": "de-AT",
            "register": "colloquial",
            "literacy": "low",
        },
        {"role": "helper", "age": 45, "language": "de-AT", "register": "colloquial"},
    ],
    "situation_text": "Meine Mutter kommt allein nicht mehr zurecht und braucht Hilfe im Alltag.",
    "goal": "pflegegeld",
    "noise": {"partial_knowledge": 0.0, "contradiction": 0.0, "dialect": 0.0},
    "gold": {
        "benefits": ["pflegegeld", "pflegeberatung"],
        "offices": {"pflegegeld": "pva-stmk"},
        "documents": {"pflegegeld": ["antrag", "befunde"]},
        "min_questions": 4,
        "citations": [SRC_PG, SRC_PB],
    },
}


def persona() -> dict[str, Any]:
    return copy.deepcopy(PERSONA)


def gold_plan(p: dict[str, Any] | None = None) -> dict[str, Any]:
    g = (p or PERSONA)["gold"]
    return {
        "benefits": list(g["benefits"]),
        "office_per_benefit": dict(g["offices"]),
        "documents_per_benefit": {k: list(v) for k, v in g["documents"].items()},
        "next_step": {"benefitId": g["benefits"][0]},
        "citations": list(g["citations"]),
    }


def fake_transport() -> FakeTransport:
    def find(inp: dict[str, Any]) -> Any:
        if "goalText" not in inp or "subject" not in inp:
            return ToolResult(ok=False, error="invalid input", code="INVALID_INPUT", malformed=True)
        return [
            {
                "id": "pflegegeld",
                "title": "Pflegegeld",
                "description": "",
                "criteria": [],
                "sources": [{"url": SRC_PG, "quote": "q", "asOf": "2026-11-06"}],
            },
            {
                "id": "pflegeberatung",
                "title": "Pflegeberatung",
                "description": "",
                "criteria": [],
                "sources": [{"url": SRC_PB, "quote": "q", "asOf": "2026-11-06"}],
            },
        ]

    def resolve(inp: dict[str, Any]) -> Any:
        if not all(inp.get(k) for k in ("benefitId", "carrier", "subjectStatus", "region")):
            return ToolResult(ok=False, error="ask", code="OFFICE_CONTEXT_REQUIRED")
        return {
            "id": "pva-stmk",
            "title": "PVA Steiermark",
            "sources": [{"url": SRC_PG, "quote": "q", "asOf": "2026-11-06"}],
        }

    def checklist(inp: dict[str, Any]) -> Any:
        return [
            {
                "type": "antrag",
                "status": "missing",
                "whereToObtain": "PVA",
                "sources": [{"url": SRC_PG, "quote": "q", "asOf": "2026-11-06"}],
            }
        ]

    return FakeTransport(
        handlers={
            "catalog.findBenefits": find,
            "office.resolve": resolve,
            "documents.checklist": checklist,
            "process.nextStep": {
                "step": None,
                "missingSlots": ["residence_region", "pension_source"],
                "questionHint": "",
                "actions": [],
            },
        }
    )
