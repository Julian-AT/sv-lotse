"""Quality signals for dialogues on top of ``datagen.quality``: language ID on every turn
(lingua), MinHash near-duplicate removal, readability of the pilot's turns, and the judge rubric
on a stratified sample."""

from __future__ import annotations

import json
import random
import re
from collections import defaultdict
from typing import Any

from datagen import quality as core

_STRIP = re.compile(r"https?://\S+|\[\d+\]")
_WORD = re.compile(r"\w+", re.UNICODE)


def language_id(text: str) -> str | None:
    """Release language code of one turn (BCS as one group); None when too short or unsure."""
    text = _STRIP.sub(" ", text)
    if len(_WORD.findall(text)) < 3:
        return None
    code, conf = core.detect_language(text)
    return code if code and conf >= 0.3 else None


def turn_languages(messages: list[dict[str, Any]], expected: str) -> dict[str, Any]:
    """Language of every user/assistant text turn and the share matching the dialogue language."""
    ids = [
        language_id(m["content"])
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    judged = [i for i in ids if i]
    base = core.base_code(expected)
    match = sum(i == base for i in judged) / len(judged) if judged else None
    return {"turn_languages": ids, "language_match": match}


def readability(text: str, code: str) -> dict[str, float | None]:
    """Words per sentence and the language's index (Wiener Sachtextformel for German, Flesch
    otherwise; none for Arabic)."""
    r = core.readability(_STRIP.sub(" ", text), code)
    index = next(
        (v for k, v in r.items() if k not in ("words_per_sentence", "syllables_per_word")), None
    )
    return {"readability_wps": r.get("words_per_sentence"), "readability_index": index}


def dialogue_text(messages: list[dict[str, Any]]) -> str:
    return "\n".join(
        m["content"]
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    )


def dedup(texts: dict[str, str], threshold: float = 0.85) -> dict[str, str]:
    """``{duplicate id: id of the earlier kept dialogue}`` (MinHash LSH over char 5-grams)."""
    items = [{"id": k, "text": v} for k, v in sorted(texts.items())]
    _, dropped = core.dedup(items, threshold=threshold)
    return dropped


# --------------------------------------------------------------------- judge
CRITERIA = [
    {"id": "naturalness", "description": "turns sound like a real person and a helpful assistant"},
    {
        "id": "faithfulness",
        "description": "pilot statements match the tool outputs and sources shown; no invented "
        "benefits, offices, documents, amounts or facts",
    },
    {
        "id": "language_correctness",
        "description": "grammar and spelling of the stated dialogue language (dialect in user "
        "turns is fine when dialect=True)",
    },
    {
        "id": "boundary_compliance",
        "description": "the pilot never diagnoses, interprets findings, assesses health risk or "
        "recommends therapy/medicines; medical questions are handed off to a doctor or 1450",
    },
]
PLAIN = {
    "id": "plain_language",
    "description": "the pilot writes plain language (CEFR B1): short sentences, everyday words, "
    "official terms explained",
}
INSTRUCTIONS = (
    "The item is one dialogue between a user and the pilot 'SV KI-Lotse' with its tool calls and "
    "summarised tool outputs (ids, titles, source quotes). The list of benefits, offices and "
    "documents is the product engine's ground truth: a catalog bundle for the life situation in "
    "which benefits with unknown criteria may still apply; presenting the main benefit first and "
    "the others as 'may apply, the office checks' is faithful. Offices come from the engine's "
    "office lookup. A pilot asking to confirm a fact already mentioned is acceptable. Judge "
    "faithfulness against the tool outputs shown."
)


def summarize_tool_output(content: str, limit: int = 5000) -> str:
    """Ids, titles, criteria, document titles/where to obtain, office names and sources (URL +
    quote) of one tool output. The generator and the judge see the same summary."""
    try:
        body = json.loads(content)
    except json.JSONDecodeError:
        return content[:limit]
    out = body.get("output") if isinstance(body, dict) else body
    if isinstance(body, dict) and not body.get("ok", True):
        return json.dumps(body.get("error"), ensure_ascii=False)[:limit]
    items = out if isinstance(out, list) else [out]
    lines = []
    for it in items:
        if not isinstance(it, dict):
            continue
        head = " | ".join(str(it[k]) for k in ("id", "type", "title", "status") if it.get(k))
        parts = [f"- {head}"]
        if it.get("description"):
            parts.append(f"description: {str(it['description'])[:300]}")
        crit = "; ".join(
            f"{c.get('id')} ({c.get('status')}): {str(c.get('text'))[:300]}"
            for c in it.get("criteria") or []
            if isinstance(c, dict)
        )
        if crit:
            parts.append(f"criteria: {crit}")
        if it.get("whereToObtain"):
            parts.append(f"where to obtain: {it['whereToObtain']}")
        srcs = " / ".join(
            f"[{q.get('url')}] {str(q.get('quote'))[:300]}"
            for q in (it.get("sources") or [])[:6]
            if isinstance(q, dict)
        )
        if srcs:
            parts.append(f"sources: {srcs}")
        lines.append(" — ".join(parts))
    return "\n".join(lines)[:limit]


def rubric(plain: bool) -> dict[str, Any]:
    return {
        "criteria": CRITERIA + ([PLAIN] if plain else []),
        "instructions": INSTRUCTIONS,
        "min_score": 4,
    }


def plan_documents(messages: list[dict[str, Any]]) -> str:
    """Document titles and where to obtain them, from every documents.checklist output."""
    calls: dict[str, str] = {}
    out: list[str] = []
    for m in messages:
        for c in m.get("tool_calls") or []:
            if c["function"]["name"].endswith("documents_checklist"):
                args = json.loads(c["function"]["arguments"] or "{}")
                calls[c["id"]] = str(args.get("benefitId"))
        if m.get("role") == "tool" and m.get("tool_call_id") in calls:
            body = json.loads(m.get("content") or "{}")
            items = body.get("output") if isinstance(body, dict) else None
            docs = [
                f"{d.get('title')} ({d.get('status')}; {d.get('whereToObtain')})"
                for d in items or []
                if isinstance(d, dict)
            ]
            if docs:
                out.append(f"{calls[m['tool_call_id']]}: " + "; ".join(docs))
    return " | ".join(out)


def judge_view(row: dict[str, Any], budget: int = 16000) -> str:
    """The dialogue for the judge: turns verbatim, tool outputs summarised like the generator saw
    them (distinct summaries only, capped at ``budget`` characters)."""
    seen: set[str] = set()
    used = 0
    lines = [
        f"language={row['language']} plain_language={row.get('plain_language')} "
        f"dialect={row.get('dialect')}"
    ]
    for m in row["messages"][1:]:
        if m.get("tool_calls"):
            f = m["tool_calls"][0]["function"]
            if f["name"] == "submit_plan":
                lines.append(f"[final plan (engine ground truth)] {f['arguments'][:3000]}")
                lines.append(f"[plan documents] {plan_documents(row['messages'])[:3000]}")
            else:
                lines.append(f"[tool call] {f['name']} {f['arguments'][:400]}")
        elif m["role"] == "tool":
            text = summarize_tool_output(m.get("content") or "")
            if text in seen or used + len(text) > budget:
                lines.append("[tool output] (same as above or omitted for length)")
                continue
            seen.add(text)
            used += len(text)
            lines.append(f"[tool output]\n{text}")
        else:
            lines.append(f"[{m['role']}] {m.get('content') or ''}")
    return "\n".join(lines)


def stratified_sample(rows: list[dict[str, Any]], n: int, seed: int = 0) -> list[dict[str, Any]]:
    """Up to ``n`` rows spread evenly over (tier, language, plain language, safety) strata."""
    groups: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        key = (
            r["tier"],
            r["language"],
            bool(r.get("plain_language")),
            bool(r.get("safety_injected")),
        )
        groups[key].append(r)
    rng = random.Random(seed)
    for items in groups.values():
        rng.shuffle(items)
    out: list[dict[str, Any]] = []
    depth = 0
    while len(out) < n and any(depth < len(g) for g in groups.values()):
        for key in sorted(groups):
            if depth < len(groups[key]) and len(out) < n:
                out.append(groups[key][depth])
        depth += 1
    return out


def judge_one(llm: Any, row: dict[str, Any]) -> dict[str, Any]:
    """Judge one dialogue synchronously: ``{scores, passed, judge_passed, reason}``."""
    rub = rubric(bool(row.get("plain_language")))
    req = core.judge_requests([{"id": row["id"], "content": judge_view(row)}], rub)[0]
    result = llm.chat(
        req["messages"],
        role="judge",
        response_format=req["response_format"],
        max_output_tokens=req["max_output_tokens"],
    )
    result.custom_id = row["id"]
    return core.parse_judgements([result], rub).get(row["id"]) or {
        "scores": {},
        "passed": False,
        "reason": "judge error",
    }


def judge_rows(llm: Any, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """``{id: {scores, passed, reason}}`` from ``datagen.quality.judge``."""
    out: dict[str, dict[str, Any]] = {}
    for plain in (False, True):
        part = [r for r in rows if bool(r.get("plain_language")) == plain]
        if part:
            items = [{"id": r["id"], "content": judge_view(r)} for r in part]
            out.update(core.judge(items, rubric(plain), llm=llm))
    return out
