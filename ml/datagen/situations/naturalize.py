"""LLM naturalisation of situation texts with rule checks, re-gold, judge sample and dedup.

Each chunk of personas (deterministic queue, split quotas) is rewritten by the bulk model in the
persona's assigned language/variant; every text then passes rule checks (language ID, no gold or
bundle benefit names, no office names, numbers only from the card, no contact data, length), is
re-labelled by the engine (`POST /gold` with the new text and language; labels never come from the
LLM), sampled for the LLM judge, and near-duplicate filtered. Chunks are written as Parquet under
<output_root>/situations/natural/ and skipped on resume.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path

import httpx
import pandas as pd
import pyarrow.dataset as ds
from pydantic import BaseModel

from personas.generate import _normalise_gold, bundle_names, crosses_family, forbidden_names
from personas.vocab import GOLD_URL, load_vocab

from .. import quality as q
from ..config import default
from ..io import write_shard
from ..llm import LLM
from .personas import gold_many, personas_dir
from .prompts import build_messages, card_language, variant_for

QUOTAS = {"train": 0.80, "val": 0.07, "test": 0.07, "heldout_family": 0.06}
JUDGE_RATE = 1.0  # every generated text that passed the rule checks is judged
# Gate: the judge scores that decide acceptance (others are recorded only).
GATE = {"faithful": 4, "no_leakage": 4, "language": 4}
MAX_OUT = 700
JUDGE_MAX_OUT = 500

RUBRIC = {
    "instructions": "The item has a persona card, a template reference message, the target "
    "language/variant, and the generated message. Judge ONLY the generated message.",
    "criteria": [
        {
            "id": "faithful",
            "description": "States only facts that are on the card or in the "
            "reference message; invents nothing (no new illnesses, amounts, people, dates).",
        },
        {
            "id": "no_leakage",
            "description": "Names no benefit, allowance, programme, leave scheme, "
            "authority or office (insurer short names like ÖGK/SVS/BVAEB/PVA are allowed).",
        },
        {
            "id": "language",
            "description": "Written in the requested language and variant "
            "(dialect, plain language, BCS variant) consistently.",
        },
        {"id": "register", "description": "Matches the requested style, register and literacy."},
        {
            "id": "natural",
            "description": "Reads like a real person's message, not like a template or an AI.",
        },
        {"id": "concern", "description": "Keeps the speaker's concern from the reference message."},
    ],
    "pass_rule": "faithful, no_leakage and language at least 4 (register, natural and concern "
    "are reported but do not decide)",
    "min_score": 1,
}


def gate_passed(scores: dict) -> bool:
    return all(scores.get(k, 0) >= v for k, v in GATE.items())


class Text(BaseModel):
    text: str


def natural_dir() -> Path:
    p = default().output_root / "situations" / "natural"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _h(s: str) -> float:
    return int(hashlib.sha256(s.encode()).hexdigest()[:12], 16) / 16**12


def build_queue(max_items: int = 200_000) -> pd.DataFrame:
    path = natural_dir() / "queue.parquet"
    if path.exists():
        return pd.read_parquet(path)
    t = ds.dataset(
        sorted(str(f) for f in personas_dir().glob("shard-*.parquet")), format="parquet"
    ).to_table(columns=["id", "split"])
    df = t.to_pandas()
    df["h"] = [_h(f"nat:{i}") for i in df["id"]]
    per = {s: g.sort_values("h")["id"].tolist() for s, g in df.groupby("split")}
    queue, taken = [], dict.fromkeys(QUOTAS, 0)
    while len(queue) < max_items and any(taken[s] < len(per.get(s, [])) for s in QUOTAS):
        # pick the split furthest below its quota
        s = min(
            (s for s in QUOTAS if taken[s] < len(per.get(s, []))),
            key=lambda s: taken[s] / max(1, len(queue)) - QUOTAS[s],
        )
        queue.append((per[s][taken[s]], s))
        taken[s] += 1
    out = pd.DataFrame(queue, columns=["id", "split"])
    out["pos"] = range(len(out))
    out.to_parquet(path, index=False)
    return out


def load_rows(ids: list[str]) -> list[dict]:
    t = ds.dataset(
        sorted(str(f) for f in personas_dir().glob("shard-*.parquet")), format="parquet"
    ).to_table(filter=ds.field("id").isin(ids))
    by = {r["id"]: r for r in t.to_pylist()}
    return [by[i] for i in ids if i in by]


NUM = re.compile(r"(?<![\w.,])\d{1,3}(?:[ .,\u00a0\u202f]\d{3})+(?![\d])|(?<![\w.,])\d+(?![\w])")
CONTACT = re.compile(r"(https?://|www\.|@\w+\.|\+?\d[\d /-]{7,}\d)")


def allowed_numbers(household: list[dict]) -> set[int]:
    ok = set(range(0, 13)) | {24, 1300, 2000, 3000, 1000}
    for m in household:
        ok.add(m["age"])
        d = m["residence"].get("district")
        if isinstance(d, int):
            ok.add(d)
        for c in m.get("children") or []:
            ok.add(c["age"])
    # ages said as "about 80" or self-corrected by one year
    ok |= {a + d for a in list(ok) for d in (-2, -1, 1, 2)}
    return ok


def rule_checks(text: str, code: str, household: list[dict], bad_terms: list[str]) -> dict:
    lang_ok, got, conf = q.language_ok(text, code, 0.5)
    leaks = q.find_leaks(text, bad_terms, min_len=5)
    nums = [int(re.sub(r"\D", "", n)) for n in NUM.findall(text)]
    allowed = allowed_numbers(household)
    bad_nums = sorted({n for n in nums if n not in allowed})
    n_words = len(q.words(text))
    contact = bool(CONTACT.search(text))
    reasons = []
    if not lang_ok:
        reasons.append(f"language:{got}:{conf:.2f}")
    if leaks:
        reasons.append("leak:" + "|".join(leaks[:3]))
    if bad_nums:
        reasons.append("numbers:" + ",".join(map(str, bad_nums[:3])))
    if not 8 <= n_words <= 220:
        reasons.append(f"length:{n_words}")
    if contact:
        reasons.append("contact")
    return {
        "lang_detected": got,
        "lang_confidence": round(conf, 3),
        "leak_hits": leaks,
        "unexpected_numbers": bad_nums,
        "n_words": n_words,
        "rule_passed": not reasons,
        "rule_reasons": reasons,
    }


class Context:
    def __init__(self):
        self.vocab = load_vocab(use_server=True)
        cat = httpx.get(f"{GOLD_URL}/catalog/summary", timeout=60).json()
        self.docs = {d["id"]: d["name_de"] for d in cat["vocabulary"]["documents"]}
        self.catalog = cat
        offices = httpx.get(f"{GOLD_URL}/health", timeout=10).json()
        self.n_offices = offices.get("offices")
        self._bundle: dict[str, list[str]] = {}
        names = []
        for b in cat["benefits"]:
            for k in ("name_de", "name_simple"):
                if b.get(k):
                    names.append(b[k])
        self.all_benefit_names = names

    def bad_terms(self, life_situation: str, gold: dict) -> list[str]:
        if life_situation not in self._bundle:
            self._bundle[life_situation] = bundle_names(self.vocab, life_situation)
        terms = set(self._bundle[life_situation])
        terms |= set(forbidden_names(self.vocab, gold.get("benefits") or []))
        terms |= set(gold.get("benefits") or [])  # ids like "pflegegeld"
        return sorted(terms)


def process_chunk(k: int, ids: list[str], llm: LLM, ctx: Context, dedup: q.NearDup) -> dict:
    rows = load_rows(ids)
    reqs, meta = [], {}
    for r in rows:
        code, sub = variant_for(r["id"])
        hh, noise = json.loads(r["household"]), json.loads(r["noise"])
        reqs.append(
            {
                "custom_id": r["id"],
                "messages": build_messages(r, hh, noise, code, sub, ctx.docs),
                "response_format": Text,
                "max_output_tokens": MAX_OUT,
            }
        )
        meta[r["id"]] = (r, code, sub, hh)
    results = llm.collect_batch(llm.submit_batch(reqs, role="bulk"))
    out, regold = [], []
    stopped = None
    transient = 0
    for res in results:
        r, code, sub, hh = meta[res.custom_id]
        rec = {
            "id": r["id"],
            "split": r["split"],
            "text_variant": code,
            "bcs_variant": sub,
            "template_text": r["situation_text"],
            "model": res.model or llm.config.role("bulk")["model"],
            "tokens_in": res.usage.get("prompt_tokens", 0),
            "tokens_out": res.usage.get("completion_tokens", 0),
        }
        if res.error or not isinstance(res.parsed, Text):
            if res.error in ("budget_exceeded", "stopped", "quota"):
                stopped = res.error
                continue
            if not str(res.error).startswith(("parse_error", "refusal")):
                transient += 1  # transport error (429/5xx after retries): redo the chunk later
            out.append(
                {**rec, "text": None, "accepted": False, "reject_reason": f"generation:{res.error}"}
            )
            continue
        text = res.parsed.text.strip()
        gold = json.loads(r["gold"])
        checks = rule_checks(text, code, hh, ctx.bad_terms(r["life_situation"], gold))
        new_hh = [dict(m, language=card_language(code, sub)) for m in hh]
        rec.update(text=text, household=json.dumps(new_hh, ensure_ascii=False), **checks)
        out.append(rec)
        if checks["rule_passed"]:
            regold.append((rec, r, new_hh))
    # Engine re-labels with the new text and language (min_questions reads the opening text).
    golds = asyncio.run(
        gold_many(
            [
                {
                    "household": hh,
                    "goal": r["goal"],
                    "life_situation": r["life_situation"],
                    "situation_text": rec["text"],
                }
                for rec, r, hh in regold
            ]
        )
    )
    for (rec, r, _), g in zip(regold, golds, strict=True):
        if isinstance(g, str) or crosses_family(r["split"], g, ctx.vocab):
            rec["rule_passed"] = False
            rec["rule_reasons"] = rec["rule_reasons"] + [
                "gold:" + (g[:60] if isinstance(g, str) else "family_boundary")
            ]
            continue
        rec["gold"] = json.dumps(_normalise_gold(g), ensure_ascii=False)
        rec["gold_benefits"] = list(g.get("benefits") or [])
    # Judge sample.
    sample = [
        rec for rec in out if rec.get("rule_passed") and _h(f"judge:{rec['id']}") < JUDGE_RATE
    ]
    if sample and stopped is None:
        items = [
            {
                "id": rec["id"],
                "content": {
                    "generation_request": build_messages(
                        meta[rec["id"]][0],
                        meta[rec["id"]][3],
                        json.loads(meta[rec["id"]][0]["noise"]),
                        rec["text_variant"],
                        rec["bcs_variant"],
                        ctx.docs,
                    )[1]["content"],
                    "generated_message": rec["text"],
                },
            }
            for rec in sample
        ]
        jres = llm.collect_batch(
            llm.submit_batch(q.judge_requests(items, RUBRIC, JUDGE_MAX_OUT), role="judge")
        )
        for r in jres:
            if r.error in ("budget_exceeded", "stopped", "quota"):
                stopped = r.error
        judged = q.parse_judgements(jres, RUBRIC)
        for rec in sample:
            j = judged.get(rec["id"])
            if j:
                rec["judge_scores"] = json.dumps(j["scores"])
                rec["judge_passed"] = gate_passed(j["scores"])
                rec["judge_reason"] = j["reason"]
    # Dedup + acceptance.
    for rec in out:
        ok = bool(rec.get("rule_passed")) and rec.get("gold") is not None
        if ok and rec.get("judge_passed") is False:
            rec["reject_reason"] = "judge"
            ok = False
        if ok:
            hit = dedup.add(rec["id"], rec["text"])
            if hit:
                rec["dup_of"] = hit
                rec["reject_reason"] = "near_duplicate"
                ok = False
        if not ok and "reject_reason" not in rec:
            rec["reject_reason"] = ";".join(rec.get("rule_reasons") or ["unknown"])
        rec["accepted"] = ok
        if rec.get("text"):
            rec["readability"] = json.dumps(q.readability(rec["text"], rec["text_variant"]))
    if stopped is None and transient > max(2, len(out) // 20):
        stopped = "transient"
    if out and stopped is None:  # a stopped chunk is redone on resume (cache makes it free)
        write_shard(_normalise(out), natural_dir() / f"chunk-{k:05d}.parquet")
    return {
        "chunk": k,
        "n": len(out),
        "accepted": sum(r["accepted"] for r in out),
        "judged": len(sample),
        "stopped": stopped,
    }


COLS = {
    "id": "",
    "split": "",
    "text_variant": "",
    "bcs_variant": None,
    "template_text": "",
    "model": "",
    "tokens_in": 0,
    "tokens_out": 0,
    "text": None,
    "household": None,
    "lang_detected": None,
    "lang_confidence": None,
    "leak_hits": [],
    "unexpected_numbers": [],
    "n_words": None,
    "rule_passed": False,
    "rule_reasons": [],
    "gold": None,
    "gold_benefits": [],
    "judge_scores": None,
    "judge_passed": None,
    "judge_reason": None,
    "dup_of": None,
    "reject_reason": None,
    "accepted": False,
    "readability": None,
}


def _normalise(rows: list[dict]) -> list[dict]:
    return [{k: r.get(k, v) for k, v in COLS.items()} for r in rows]
