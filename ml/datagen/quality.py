"""Quality toolkit shared by all families.

- `detect_language(text)` / `language_ok(text, code)`: lingua language ID restricted to the release
  languages plus close confusers. Release codes: de (also de-AT-dialect, de-easy), en, tr, bcs
  (Bosnian/Croatian/Serbian are one group), ro, hu, pl, uk, ar.
- `NearDup`: MinHash LSH near-duplicate filter (datasketch, char 5-gram shingles).
- `distinct_n`, `length_stats`, `readability` (1st Wiener Sachtextformel for German; Flesch reading
  ease for English; a language-neutral Flesch-style score from vowel-group syllables otherwise;
  Arabic gets words per sentence only).
- `judge(items, rubric, llm=…)`: LLM-judge with structured output (score 1-5 per criterion, pass,
  reason) through role="judge". `judge_requests`/`parse_judgements` do the same via submit_batch.
- `find_leaks(text, terms)` and `leak_terms(...)`: leakage helpers (gold names in generated text).
"""

from __future__ import annotations

import math
import re
import statistics
import unicodedata
from collections import Counter
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field

# --- language ID ---

BASE = {"de-AT-dialect": "de", "de-easy": "de", "bs": "bcs", "hr": "bcs", "sr": "bcs"}


def base_code(code: str) -> str:
    return BASE.get(code, code)


@lru_cache(maxsize=1)
def _detector():
    from lingua import Language as L
    from lingua import LanguageDetectorBuilder

    langs = [
        L.GERMAN,
        L.ENGLISH,
        L.TURKISH,
        L.BOSNIAN,
        L.CROATIAN,
        L.SERBIAN,
        L.ROMANIAN,
        L.HUNGARIAN,
        L.POLISH,
        L.UKRAINIAN,
        L.ARABIC,
        L.RUSSIAN,
        L.SLOVAK,
        L.CZECH,
        L.SLOVENE,
        L.DUTCH,
        L.ITALIAN,
        L.PERSIAN,
        L.FRENCH,
        L.SPANISH,
        L.BULGARIAN,
    ]
    return LanguageDetectorBuilder.from_languages(*langs).with_preloaded_language_models().build()


def detect_language(text: str) -> tuple[str | None, float]:
    """(release code or ISO 639-1 of a confuser, confidence). BCS languages map to `bcs`."""
    det = _detector()
    vals = det.compute_language_confidence_values(text)
    if not vals:
        return None, 0.0
    agg: Counter = Counter()
    for v in vals:
        code = v.language.iso_code_639_1.name.lower()
        agg[base_code(code)] += v.value
    code, conf = agg.most_common(1)[0]
    return code, float(conf)


def language_ok(text: str, code: str, min_conf: float = 0.5) -> tuple[bool, str | None, float]:
    got, conf = detect_language(text)
    return got == base_code(code) and conf >= min_conf, got, conf


# --- near duplicates ---


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text)).strip()


def shingles(text: str, k: int = 5) -> set[str]:
    t = _norm(text)
    return {t[i : i + k] for i in range(max(1, len(t) - k + 1))}


class NearDup:
    """Insert texts in order; `add` returns the id of an earlier near-duplicate or None."""

    def __init__(self, threshold: float = 0.85, num_perm: int = 64, k: int = 5):
        from datasketch import MinHashLSH

        self.lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
        self.num_perm, self.k = num_perm, k

    def _mh(self, text: str):
        from datasketch import MinHash

        m = MinHash(num_perm=self.num_perm)
        m.update_batch([s.encode() for s in shingles(text, self.k)])
        return m

    def add(self, key: str, text: str) -> str | None:
        m = self._mh(text)
        hits = [h for h in self.lsh.query(m) if h != key]
        if hits:
            return sorted(hits)[0]
        if key not in self.lsh.keys:
            self.lsh.insert(key, m)
        return None


def dedup(
    items: list[dict], text_key: str = "text", id_key: str = "id", threshold: float = 0.85
) -> tuple[list[dict], dict[str, str]]:
    """Keep the first of each near-duplicate cluster. Returns (kept, {dropped_id: kept_id})."""
    nd = NearDup(threshold)
    kept, dropped = [], {}
    for it in items:
        hit = nd.add(str(it[id_key]), it[text_key])
        if hit is None:
            kept.append(it)
        else:
            dropped[str(it[id_key])] = hit
    return kept, dropped


# --- diversity and length ---

WORD = re.compile(r"\w+", re.UNICODE)


def words(text: str) -> list[str]:
    return WORD.findall(text.casefold())


def distinct_n(texts: list[str], n: int = 2) -> float:
    total, uniq = 0, set()
    for t in texts:
        w = words(t)
        grams = list(zip(*(w[i:] for i in range(n)), strict=False))
        total += len(grams)
        uniq.update(grams)
    return len(uniq) / total if total else 0.0


def length_stats(texts: list[str]) -> dict:
    lens = sorted(len(words(t)) for t in texts)
    if not lens:
        return {"n": 0}
    q = lambda p: lens[min(len(lens) - 1, int(p * len(lens)))]  # noqa: E731
    return {
        "n": len(lens),
        "mean_words": round(statistics.fmean(lens), 2),
        "p05": q(0.05),
        "p50": q(0.5),
        "p95": q(0.95),
        "min": lens[0],
        "max": lens[-1],
    }


# --- readability ---

VOWELS = re.compile(r"[aeiouyäöüáéíóúàèìòùâêîôûăâîșțąęóıöüőűéáíóúаеєиіїоуюяыэё]+", re.I)
SENT = re.compile(r"[.!?؟…]+|\n+")


def syllables(word: str) -> int:
    return max(1, len(VOWELS.findall(word)))


def readability(text: str, code: str) -> dict:
    base = base_code(code)
    sents = [s for s in SENT.split(text) if WORD.search(s)] or [text]
    ws = [w for w in WORD.findall(text) if not w.isdigit()]
    if not ws:
        return {"words_per_sentence": 0.0}
    wps = len(ws) / len(sents)
    out: dict[str, Any] = {"words_per_sentence": round(wps, 2)}
    if base == "ar":
        return out
    syl = [syllables(w) for w in ws]
    spw = sum(syl) / len(ws)
    if base == "de":
        ms = 100 * sum(s >= 3 for s in syl) / len(ws)
        iw = 100 * sum(len(w) > 6 for w in ws) / len(ws)
        es = 100 * sum(s == 1 for s in syl) / len(ws)
        out["wiener_sachtextformel"] = round(
            0.1935 * ms + 0.1672 * wps + 0.1297 * iw - 0.0327 * es - 0.875, 2
        )
    elif base == "en":
        out["flesch_reading_ease"] = round(206.835 - 1.015 * wps - 84.6 * spw, 2)
    else:
        out["flesch_style"] = round(206.835 - 1.015 * wps - 84.6 * spw, 2)
    out["syllables_per_word"] = round(spw, 3)
    return out


# --- leakage ---


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.casefold())
    return "".join(c for c in s if not unicodedata.combining(c)).replace("ß", "ss")


def find_leaks(text: str, terms: list[str], min_len: int = 5) -> list[str]:
    """Terms (benefit/office names, ids) that occur in text, accent- and case-insensitive,
    on word boundaries. Terms shorter than min_len are ignored (too ambiguous)."""
    t = " " + re.sub(r"[^\w]+", " ", _fold(text)) + " "
    hits = []
    for term in terms:
        f = re.sub(r"[^\w]+", " ", _fold(term)).strip()
        if len(f) >= min_len and f" {f} " in t:
            hits.append(term)
    return hits


def leak_terms(gold: dict, catalog: dict | None = None) -> list[str]:
    """Names that must not appear in a text generated for a persona with this gold: benefit ids
    and catalog names of gold benefits, and office names. `catalog` is GET /catalog/summary."""
    ids = list(gold.get("benefits") or [])
    terms = [i.replace("_", " ").replace("-", " ") for i in ids]
    if catalog:
        by_id = {b["id"]: b for b in catalog.get("benefits", [])}
        for i in ids:
            b = by_id.get(i) or {}
            names = b.get("names") or {}
            terms += [v for v in (names.values() if isinstance(names, dict) else names) if v]
    for o in gold.get("offices") or []:
        if isinstance(o, dict):
            terms += [v for k, v in o.items() if k in ("name", "short_name", "shortName") and v]
    return sorted(set(terms))


# --- LLM judge ---


class Score(BaseModel):
    criterion: str
    score: int = Field(ge=1, le=5)


class Judgement(BaseModel):
    scores: list[Score]
    passed: bool
    reason: str


def _judge_messages(item: dict, rubric: dict) -> list[dict]:
    crit = "\n".join(f"- {c['id']}: {c['description']}" for c in rubric["criteria"])
    sys = (
        "You are a strict data-quality judge for a synthetic dataset about Austrian social "
        "benefits. Score each criterion from 1 (bad) to 5 (excellent). "
        f"{rubric.get('instructions', '')}\nCriteria:\n{crit}\n"
        f"Pass rule: {rubric.get('pass_rule', 'every criterion scores at least 4')}. "
        "Reply with JSON only: scores (one per criterion id, in order), passed, reason (one short "
        "sentence, English)."
    )
    import json

    content = (
        item["content"]
        if isinstance(item["content"], str)
        else json.dumps(item["content"], ensure_ascii=False)
    )
    return [{"role": "system", "content": sys}, {"role": "user", "content": content}]


def judge_requests(items: list[dict], rubric: dict, max_output_tokens: int = 600) -> list[dict]:
    """Requests for LLM.submit_batch(..., role="judge"); items need `id` and `content`."""
    return [
        {
            "custom_id": str(it["id"]),
            "messages": _judge_messages(it, rubric),
            "response_format": Judgement,
            "max_output_tokens": max_output_tokens,
        }
        for it in items
    ]


def _apply_min(j: Judgement, rubric: dict) -> dict:
    scores = {s.criterion: s.score for s in j.scores}
    min_score = rubric.get("min_score", 4)
    rule_pass = all(scores.get(c["id"], 0) >= min_score for c in rubric["criteria"])
    return {
        "scores": scores,
        "passed": bool(j.passed and rule_pass),
        "judge_passed": j.passed,
        "reason": j.reason,
    }


def parse_judgements(results, rubric: dict) -> dict[str, dict]:
    out = {}
    for r in results:
        if r.error or not isinstance(r.parsed, Judgement):
            out[r.custom_id] = {"scores": {}, "passed": False, "reason": f"judge error: {r.error}"}
        else:
            out[r.custom_id] = _apply_min(r.parsed, rubric)
    return out


def judge(items: list[dict], rubric: dict, *, llm, max_output_tokens: int = 600) -> dict[str, dict]:
    """Judge items (dicts with `id`, `content`) against `rubric` = {criteria: [{id, description}],
    instructions?, pass_rule?, min_score? (default 4)}. Returns {id: {scores, passed, reason}};
    passed requires the judge's pass AND every criterion >= min_score."""
    bid = llm.submit_batch(judge_requests(items, rubric, max_output_tokens), role="judge")
    return parse_judgements(llm.collect_batch(bid, wait=True), rubric)


def wilson(passed: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval for a pass rate (for judge samples)."""
    if n == 0:
        return (0.0, 1.0)
    p = passed / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round((c - m) / d, 4), round((c + m) / d, 4))
