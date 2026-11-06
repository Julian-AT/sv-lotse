"""Rule checks applied to every generated question (no LLM)."""

from __future__ import annotations

import re
import unicodedata

from datagen.legal_qa.corpus import Section

ACTS = r"ASVG|BSVG|GSVG|B-KUVG|FLAG|BPGG|KBGG|KUG|PFG|EinstV|SH-GG|AufwAnp|FSVG|NVG|SVSG|AlVG"
CITATION = re.compile(
    rf"§|\bAbs\.|\bAbsatz\b|\bParagra(ph|f)|\bZ\s?\d|\b({ACTS})\b|dieser? (Bestimmung|Paragra)",
    re.I,
)
MAX_VERBATIM = 6  # longest run of consecutive section tokens a question may reuse
WORD = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> list[str]:
    return WORD.findall(unicodedata.normalize("NFKC", text).casefold())


def longest_common_run(a: list[str], b: list[str]) -> int:
    """Length of the longest common contiguous token run (dynamic programming, O(len a·len b))."""
    if not a or not b:
        return 0
    positions: dict[str, list[int]] = {}
    for j, tok in enumerate(b):
        positions.setdefault(tok, []).append(j)
    best = 0
    prev: dict[int, int] = {}
    for tok in a:
        cur: dict[int, int] = {}
        for j in positions.get(tok, ()):
            cur[j] = prev.get(j - 1, 0) + 1
            best = max(best, cur[j])
        prev = cur
    return best


def _norm(text: str) -> str:
    return " ".join(_tokens(text))


def evidence_found(quote: str, section_text: str) -> bool:
    q, s = _tokens(quote), _tokens(section_text)
    if len(q) < 3:
        return False
    if _norm(quote) in _norm(section_text):
        return True
    return longest_common_run(q, s) >= max(3, int(0.8 * len(q)))


def check(q: dict, section: Section, language_ok=None) -> dict:
    """Return {check: bool} for one question record (q has question, question_de, answer,
    absatz, evidence_quote, language)."""
    words = _tokens(q["question"])
    sec = _tokens(section.text)
    res = {
        "length": 4 <= len(words) <= 90,
        "verbatim": longest_common_run(words, sec) <= MAX_VERBATIM,
        "verbatim_de": longest_common_run(_tokens(q["question_de"]), sec) <= MAX_VERBATIM + 2,
        "no_citation": not CITATION.search(q["question"]) and not CITATION.search(q["question_de"]),
        "answer": bool(q["answer"].strip()),
        "absatz": all(a in section.absaetze for a in q["absatz"]) if section.absaetze else True,
        "evidence": evidence_found(q["evidence_quote"], section.text),
    }
    if language_ok is not None:
        res["language"] = language_ok(q["question"], q["language"])
    return res


def passed(checks: dict) -> bool:
    return all(checks.values())
