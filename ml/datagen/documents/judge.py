"""LLM judge for generated documents (filter: only passing documents are released)."""

from __future__ import annotations

import json
from typing import Any

from ..quality import judge

RUBRIC = {
    "instructions": (
        "The item is one synthetic German (Austrian) document as rendered (page text), followed by "
        "its gold annotations (typed verbatim quotes) and the structured spec it was generated "
        "from. Institutions marked fictional and the footer line are intended. Judge the document "
        "and the gold, not the policy of labelling synthetic data. The page text is a PDF "
        "text-layer serialization: items on the same baseline (e.g. the address block on the "
        "left and the reference/date block on the right) are merged into one line - that is "
        "expected, not a garbled header. Salutation, closing and signature come from the layout. "
        "The appeal instructions follow Austrian practice (Klage at the labour and social court "
        "for social-insurance benefits, Beschwerde for the tax office and provincial authorities)."
    ),
    "criteria": [
        {
            "id": "realism",
            "description": "Reads like a real Austrian document of this type (structure, register, "
            "terminology, plausible fictional clinical content for discharge letters).",
        },
        {
            "id": "consistency",
            "description": "Internally consistent: dates, names, amounts, care level, outcome and "
            "the facts in the spec agree everywhere; nothing contradicts the spec.",
        },
        {
            "id": "boundary",
            "description": "Medical boundary: recommendations in discharge letters are explicit "
            "documented recommendations without the reader being given medical advice; "
            "administrative letters contain no medical assessment; no gold annotation is a "
            "diagnosis, finding or medical rationale.",
        },
        {
            "id": "german",
            "description": "Correct, idiomatic German (Austrian standard); plain-language letters "
            "really are plain (short sentences).",
        },
        {
            "id": "gold",
            "description": "Every gold quote has the right type (documented_recommendation vs "
            "administrative_fact and fact_type); documented recommendations in the text are not "
            "missing from the gold.",
        },
    ],
    "pass_rule": "every criterion scores at least 4",
    "min_score": 4,
}


def item(row: dict[str, Any]) -> dict[str, Any]:
    statements = json.loads(row["statements"])
    spec = json.loads(row["spec"])
    keep = (
        "doc_type",
        "register",
        "letter_date",
        "benefit_name",
        "outcome",
        "care_level",
        "deadline",
        "recommendations",
        "requested_documents",
        "decision_reason",
        "legal_basis",
        "application_date",
        "amount_basis",
        "aid",
        "medicines",
        "clinical_theme",
    )
    content = (
        f"DOCUMENT TYPE: {row['doc_type']} (register: {row['register']})\n\n"
        f"PAGE TEXT:\n{row['text'][:9000]}\n\n"
        "GOLD (type / fact_type / quote):\n"
        + "\n".join(f"- {s['type']} / {s['fact_type']} / {s['quote']!r}" for s in statements)
        + "\n\nSPEC:\n"
        + json.dumps({k: spec.get(k) for k in keep}, ensure_ascii=False)
    )
    return {"id": row["id"], "content": content}


def judge_rows(rows: list[dict[str, Any]], llm) -> dict[str, dict]:
    if not rows:
        return {}
    return judge([item(r) for r in rows], RUBRIC, llm=llm, max_output_tokens=900)
