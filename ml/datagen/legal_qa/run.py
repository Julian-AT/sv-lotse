"""AT-Benefits `legal_qa` family: graded multilingual retrieval questions over RIS sections.

    uv run python -m datagen.legal_qa.run --tranche 1 [--limit N] [--verify 30] [--no-generate]

Pipeline (filtering after arXiv 2601.14160: generate from legislation, rule-filter, LLM-judge,
deduplicate):
1. Every eligible section of the RIS corpus (JulianAT/at-sv-law; repealed and stub sections
   dropped) gets 1-4 question slots (language, style, difficulty; German majority) by a seeded plan.
2. One bulk-model call per section writes the questions, a German rendering, a short answer, the
   Absatz numbers and a verbatim evidence quote (structured output). Chunks of sections are
   cached on disk (resumable; the core LLM cache also makes reruns free).
3. Rule checks on every question: language ID, no verbatim copying beyond 6 tokens, no citation
   of §/Absatz/law name, evidence quote found in the section, Absatz numbers valid, length.
4. MinHash near-duplicate removal per language (0.85).
5. LLM judge (role judge) on EVERY rule-passing question, one call per section: answerable
   only from the section, correct, self-contained, natural, no verbatim copying. Only passing
   questions are released; unjudged questions (budget) are held back until judged.
6. Hard negatives: BM25 over all sections with the German rendering as query (top 10, positive
   and parallel provisions with the same title in other acts excluded and listed separately).

Budget: tokens from the `forms_legal_qa` pool; stops cleanly on BudgetExceeded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from pydantic import BaseModel, Field

from datagen import io
from datagen.legal_qa import checks as rules
from datagen.legal_qa.corpus import ATTRIBUTION, BM25, LICENCE, Section, eligible, load_sections
from datagen.legal_qa.generate import PROMPT_VERSION, Generation, request, slot_plan
from datagen.llm import LLM, BudgetExceeded, QuotaError

FAMILY = "legal_qa"
CHUNK = 32
GEN_ROLE = "strong"  # same token cost as bulk on the proxy; fewer wrong case questions
N_NEG = 10


def split_of(doc_id: str) -> str:
    h = int(hashlib.sha256(f"split:{doc_id}".encode()).hexdigest()[:8], 16) % 100
    return "test" if h < 5 else "val" if h < 10 else "train"


def work_dir() -> Path:
    return io.family_dir(FAMILY)


# ---------------------------------------------------------------- generation


def generate(
    sections: list[Section], tranche: int, llm: LLM, root: Path, judge_all: bool = True
) -> dict:
    by_id = {s.doc_id: s for s in sections}
    raw = root / "raw" / f"t{tranche}-{PROMPT_VERSION}"
    raw.mkdir(parents=True, exist_ok=True)
    stats = Counter()
    chunks = [sections[i : i + CHUNK] for i in range(0, len(sections), CHUNK)]
    for k, chunk in enumerate(chunks):
        key = hashlib.sha256("|".join(s.doc_id for s in chunk).encode()).hexdigest()[:10]
        path = raw / f"chunk-{k:04d}-{key}.jsonl"
        if path.exists():  # complete chunk (a .partial.jsonl sibling is retried below)
            stats["chunks_cached"] += 1
            if judge_all:
                stats.update(judge_chunk(path, by_id, llm, root, tranche))
            continue
        reqs = [request(s, tranche) for s in chunk]
        try:
            results = llm.collect_batch(llm.submit_batch(reqs, role=GEN_ROLE), wait=True)
        except BudgetExceeded as e:
            stats["stopped_budget"] += 1
            print(f"legal_qa: budget reached ({e}); stopping generation", file=sys.stderr)
            break
        rows, stop = [], False
        for s, r in zip(chunk, results, strict=True):
            if r.error:
                stats["errors"] += 1
                if "budget" in (r.error or "") or "stopped" in (r.error or ""):
                    stop = True
                continue
            gen: Generation = r.parsed
            rows.append(
                {
                    "doc_id": s.doc_id,
                    "tranche": tranche,
                    "slots": slot_plan(s, tranche),
                    "usable": gen.usable,
                    "questions": [q.model_dump() for q in gen.questions],
                    "usage": r.usage,
                    "model": r.model,
                }
            )
        if stop:
            # Do not mark a partial chunk as done; the cache makes the retry free.
            stats["stopped_budget"] += 1
            break
        # Sections that failed (for example repeated 429s) leave the chunk partial: its rows are
        # usable now, and the next run retries the whole chunk (successes replay from cache).
        partial = path.with_name(path.stem + ".partial.jsonl")
        failed = len(chunk) - len(rows)
        target = partial if failed else path
        tmp = target.with_suffix(".tmp")
        tmp.write_text("".join(json.dumps(x, ensure_ascii=False) + "\n" for x in rows))
        if not failed:
            for old in (partial, root / "judge" / raw.name / partial.name):
                old.unlink(missing_ok=True)
        tmp.replace(target)
        stats["chunks_partial" if failed else "chunks_done"] += 1
        if judge_all:
            try:
                stats.update(judge_chunk(target, by_id, llm, root, tranche))
            except BudgetExceeded:
                stats["stopped_budget"] += 1
                break
        print(
            f"  chunk {k + 1}/{len(chunks)} remaining={llm.remaining()['family']}", file=sys.stderr
        )
    return dict(stats)


# ---------------------------------------------------------------- assembly


def _language_ok(text: str, code: str) -> bool:
    from datagen.quality import language_ok

    ok, _, _ = language_ok(text, code, min_conf=0.5)
    return ok


def records_from_row(row: dict, s: Section, stats: Counter | None = None) -> list[dict]:
    stats = stats if stats is not None else Counter()
    if not row["usable"]:
        stats["sections_unusable"] += 1
        return []
    slots = {x["slot"]: x for x in row["slots"]}
    out = []
    for q in row["questions"]:
        slot = slots.get(q["slot"])
        if slot is None:
            stats["bad_slot"] += 1
            continue
        rec = {
            "id": f"{s.doc_id}:t{row['tranche']}:q{q['slot']}",
            "query": q["question"].strip(),
            "query_de": q["question_de"].strip(),
            "language": slot["language"],
            "style": slot["style"],
            "difficulty": slot["difficulty"],
            "answer": q["answer"].strip(),
            "absatz": [str(a).strip() for a in q["absatz"]],
            "evidence_quote": q["evidence_quote"].strip(),
            "positive_id": s.doc_id,
            "act": s.act,
            "paragraph": s.paragraph,
            "tranche": row["tranche"],
            "model": row.get("model"),
        }
        rec["checks"] = rules.check(
            rec | {"question": rec["query"], "question_de": rec["query_de"]}, s, _language_ok
        )
        stats["generated"] += 1
        out.append(rec)
    return out


def load_verdicts(root: Path) -> dict[str, dict]:
    out = {}
    for path in sorted((root / "judge").glob("t*/chunk-*.jsonl")):
        for line in path.open():
            v = json.loads(line)
            out[v["id"]] = v
    return out


def assemble(sections: list[Section], root: Path) -> tuple[list[dict], dict]:
    by_id = {s.doc_id: s for s in sections}
    verdicts = load_verdicts(root)
    out, stats = [], Counter()
    seen: set = set()
    for path in sorted((root / "raw").glob("t*/chunk-*.jsonl")):
        for line in path.open():
            row = json.loads(line)
            s = by_id.get(row["doc_id"])
            if s is None:
                continue
            if (row["doc_id"], row["tranche"]) in seen:
                continue  # the same section in an earlier (for example partial) chunk file
            seen.add((row["doc_id"], row["tranche"]))
            for rec in records_from_row(row, s, stats):
                if rec["id"] in verdicts:
                    rec["judge"] = verdicts[rec["id"]]
                out.append(rec)
    return out, dict(stats)


# ---------------------------------------------------------------- judge (every question)


class ItemVerdict(BaseModel):
    id: str
    answerable: int = Field(ge=1, le=5)
    correct: int = Field(ge=1, le=5)
    self_contained: int = Field(ge=1, le=5)
    natural: int = Field(ge=1, le=5)
    copies_section: bool
    reason: str


class SectionVerdict(BaseModel):
    items: list[ItemVerdict]


JUDGE_SYSTEM = """You are a strict quality judge for a retrieval dataset over Austrian \
social-insurance law. You get one law section and questions (any language) written for it, each \
with a German rendering and a reference answer. Score every question from 1 to 5:
- answerable: the section alone fully answers the question; no outside knowledge or other \
provisions are needed (5 = fully, 3 = only partly, 1 = not at all).
- correct: the reference answer is correct and complete according to the section.
- self_contained: the question is understandable without seeing the section, does not refer to \
"this section/law" and does not cite paragraph numbers or the law's name.
- natural: natural phrasing in its language and register (colloquial or plain questions are \
fine), as a real person would ask.
copies_section: true if the question copies a longer passage of the section verbatim (more than \
about six consecutive words, ignoring fixed legal terms).
reason: one short English sentence. Return one item per question id, in order."""


def judge_requests(records: list[dict], by_id: dict[str, Section], tranche: int) -> list[dict]:
    from datagen.legal_qa.corpus import truncate

    groups: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        groups[r["positive_id"]].append(r)
    reqs = []
    for doc_id, items in groups.items():
        s = by_id[doc_id]
        qs = [
            {
                "id": r["id"],
                "language": r["language"],
                "question": r["query"],
                "question_de": r["query_de"],
                "reference_answer": r["answer"],
            }
            for r in items
        ]
        user = (
            f"Section: {s.paragraph} {s.act} – {s.title}\n<<<\n{truncate(s.text)}\n>>>\n\n"
            f"Questions:\n{json.dumps(qs, ensure_ascii=False, indent=1)}"
        )
        reqs.append(
            {
                "custom_id": f"judge:{doc_id}:t{tranche}:{len(items)}",
                "messages": [
                    {"role": "system", "content": JUDGE_SYSTEM},
                    {"role": "user", "content": user},
                ],
                "response_format": SectionVerdict,
                "max_output_tokens": 400 + 250 * len(items),
            }
        )
    return reqs


def verdict_passed(v: dict) -> bool:
    return (
        v["answerable"] >= 4
        and v["correct"] >= 4
        and v["self_contained"] >= 4
        and v["natural"] >= 3
        and not v["copies_section"]
    )


def judge_records(
    records: list[dict], by_id: dict[str, Section], tranche: int, llm: LLM
) -> dict[str, dict]:
    """Judge every given record (one call per section). Returns {id: verdict}."""
    if not records:
        return {}
    reqs = judge_requests(records, by_id, tranche)
    results = llm.collect_batch(llm.submit_batch(reqs, role="judge"), wait=True)
    wanted = {r["id"] for r in records}
    out = {}
    for res in results:
        if res.error or not isinstance(res.parsed, SectionVerdict):
            continue
        for it in res.parsed.items:
            if it.id in wanted:
                v = it.model_dump()
                v["passed"] = verdict_passed(v)
                out[it.id] = v
    return out


def judge_chunk(
    raw_path: Path, by_id: dict[str, Section], llm: LLM, root: Path, tranche: int
) -> Counter:
    out_path = root / "judge" / raw_path.parent.name / raw_path.name
    stats = Counter()
    if out_path.exists():
        stats["judge_cached"] += 1
        return stats
    records = []
    for line in raw_path.open():
        row = json.loads(line)
        s = by_id.get(row["doc_id"])
        if s:
            records += records_from_row(row, s)
    todo = [r for r in records if rules.passed(r["checks"])]
    stats["rule_failed"] += len(records) - len(todo)
    verdicts = judge_records(todo, by_id, tranche, llm)
    stats["judged"] += len(verdicts)
    stats["judge_missing"] += len(todo) - len(verdicts)
    if len(verdicts) < 0.9 * len(todo):
        # Too many failed judge calls (budget or backend): retry the chunk on the next run.
        stats["judge_incomplete"] += 1
        return stats
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(
        "".join(json.dumps({"id": k, **v}, ensure_ascii=False) + "\n" for k, v in verdicts.items())
    )
    tmp.replace(out_path)
    return stats


def dedup(records: list[dict]) -> int:
    from datagen.quality import NearDup

    by_lang: dict[str, NearDup] = {}
    dropped = 0
    for r in records:
        nd = by_lang.setdefault(r["language"], NearDup(threshold=0.85))
        hit = nd.add(r["id"], r["query"])
        r["checks"]["near_dup"] = hit is None
        dropped += hit is not None
    return dropped


def hard_negatives(records: list[dict], sections: list[Section]) -> None:
    index = BM25([f"{s.title}\n{s.text}" for s in sections])
    pos = {s.doc_id: i for i, s in enumerate(sections)}
    titles = defaultdict(list)
    for i, s in enumerate(sections):
        if s.title.strip():
            titles[s.title.strip().casefold()].append(i)
    for start in range(0, len(records), 256):
        batch = records[start : start + 256]
        scores = index.scores([r["query_de"] for r in batch])
        for r, row in zip(batch, scores, strict=True):
            target = pos[r["positive_id"]]
            sec = sections[target]
            parallel = {i for i in titles.get(sec.title.strip().casefold(), []) if i != target}
            order = row.argsort()[::-1]
            negs = []
            for i in order:
                i = int(i)
                if i == target or i in parallel:
                    continue
                if row[i] <= 0 or len(negs) >= N_NEG:
                    break
                negs.append(i)
            r["negative_ids"] = [sections[i].doc_id for i in negs]
            r["negative_scores"] = [round(float(row[i]), 3) for i in negs]
            r["parallel_ids"] = [sections[i].doc_id for i in sorted(parallel)]
            r["bm25_rank"] = int((row > row[target]).sum()) + 1 if row[target] > 0 else None


# ---------------------------------------------------------------- judge


def judge_metrics(verdicts: dict, records: dict) -> dict:
    from datagen.quality import wilson

    n = len(verdicts)
    passed = sum(v["passed"] for v in verdicts.values())
    crit = defaultdict(list)
    by_lang = defaultdict(lambda: [0, 0])
    by_diff = defaultdict(lambda: [0, 0])
    for k, v in verdicts.items():
        for c in ("answerable", "correct", "self_contained", "natural"):
            crit[c].append(v[c])
        crit["copies_section"].append(int(v["copies_section"]))
        r = records.get(k)
        if r:
            by_lang[r["language"]][0] += v["passed"]
            by_lang[r["language"]][1] += 1
            by_diff[r["difficulty"]][0] += v["passed"]
            by_diff[r["difficulty"]][1] += 1
    return {
        "n": n,
        "pass_rate": round(passed / n, 4) if n else None,
        "pass_rate_ci95": wilson(passed, n),
        "mean_scores": {c: round(sum(x) / len(x), 3) for c, x in crit.items()},
        "pass_by_language": {k: round(a / b, 3) for k, (a, b) in sorted(by_lang.items())},
        "pass_by_difficulty": {k: round(a / b, 3) for k, (a, b) in sorted(by_diff.items())},
    }


def verify(sections: list[Section], root: Path, n: int, llm: LLM) -> int:
    """Judge the first n rule-passing questions of the existing raw output; print the pass rate."""
    by_id = {s.doc_id: s for s in sections}
    records, _ = assemble(sections, root)
    todo = [r for r in records if rules.passed(r["checks"])][:n]
    verdicts = judge_records(todo, by_id, 1, llm)
    m = judge_metrics(verdicts, {r["id"]: r for r in todo})
    for r in todo:
        v = verdicts.get(r["id"])
        if v and not v["passed"]:
            print(
                f"FAIL {r['id']} [{r['language']}] {r['query'][:90]} :: {v['reason']}",
                file=sys.stderr,
            )
    print(json.dumps(m, ensure_ascii=False), file=sys.stderr)
    return 0


# ---------------------------------------------------------------- release


def release_rows(records: list[dict], sections: list[Section]) -> dict[str, list[dict]]:
    by_id = {s.doc_id: s for s in sections}
    out = defaultdict(list)
    for r in records:
        s = by_id[r["positive_id"]]
        out[split_of(r["positive_id"])].append(
            {
                "id": r["id"],
                "query": r["query"],
                "query_de": r["query_de"],
                "language": r["language"],
                "style": r["style"],
                "difficulty": r["difficulty"],
                "positive_id": r["positive_id"],
                "positive_act": s.act,
                "positive_paragraph": s.paragraph,
                "positive_absatz": r["absatz"],
                "positive_title": s.title,
                "positive_text": s.text,
                "positive_url": s.url,
                "negative_ids": r["negative_ids"],
                "negative_bm25": r["negative_scores"],
                "parallel_ids": r["parallel_ids"],
                "bm25_rank_de": r["bm25_rank"],
                "answer": r["answer"],
                "evidence_quote": r["evidence_quote"],
                "judge": json.dumps(r["judge"], ensure_ascii=False) if r.get("judge") else None,
                "version_as_of": s.version_as_of,
                "licence": LICENCE,
                "attribution": ATTRIBUTION,
            }
        )
    return out


CARD = """## legal_qa

Graded multilingual retrieval questions over Austrian social-insurance law. Each row is a query
whose answer is one exact RIS section (and Absatz where possible) of the corpus
[JulianAT/at-sv-law](https://huggingface.co/datasets/JulianAT/at-sv-law), with BM25 hard negatives.

- **Generation.** For each eligible section ({sections} of 2,863; repealed and stub sections
  dropped) a seeded plan assigns 1-4 slots (language, style, difficulty easy/medium/hard); a
  language model writes the question, a German rendering, a short answer, the Absatz numbers and
  a verbatim evidence quote. Languages: German majority (standard, plain language, colloquial
  Austrian), English, Turkish, BCS, Romanian, Hungarian, Polish, Ukrainian, Arabic.
- **Filtering** (after arXiv 2601.14160): rule checks on every question (language ID, at most 6
  consecutive tokens copied from the section, no § / Absatz / law-name citation, evidence quote
  found in the section, valid Absatz numbers, length), MinHash near-duplicate removal per
  language, and an LLM judge on every question (answerable only from the section, correct,
  self-contained, natural, no verbatim copying); only passing questions are kept: {judge}.
- **Negatives.** `negative_ids`: top-10 BM25 sections for the German rendering, excluding the
  positive and parallel provisions with the same title in other acts (`parallel_ids`, which may
  also answer the question). `bm25_rank_de` is the positive's BM25 rank (difficulty signal).
- **Splits** by section (no section in two splits): train/val/test = 90/5/5.

Counts: {rows} questions ({by_lang}). Law texts: {attribution}, licence CC BY 4.0.
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AT-Benefits legal_qa family")
    ap.add_argument("--tranche", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0, help="first N eligible sections only")
    ap.add_argument(
        "--verify",
        type=int,
        default=0,
        help="judge N rule-passing questions from existing raw output and exit",
    )
    ap.add_argument("--no-generate", action="store_true", help="assemble existing raw output")
    ap.add_argument(
        "--min-remaining",
        type=int,
        default=50_000,
        help="do not start generation below this many family tokens",
    )
    args = ap.parse_args(argv)
    started = time.time()
    root = work_dir()
    all_sections = load_sections()
    sections = [s for s in all_sections if eligible(s.text)]
    order = sorted(sections, key=lambda s: hashlib.sha256(s.doc_id.encode()).hexdigest())
    if args.limit:
        order = order[: args.limit]
    llm = LLM(FAMILY)
    if args.verify:
        return verify(all_sections, root, args.verify, llm)
    gen_stats: dict = {}
    if not args.no_generate:
        from datagen.check_key import check

        ok, msg = check()
        for _ in range(10):  # 429 from a busy shared proxy is transient
            if ok or " 429 " not in f" {msg} ":
                break
            time.sleep(30)
            ok, msg = check()
        if not ok:
            print(f"legal_qa: key check failed, generation skipped: {msg}", file=sys.stderr)
            gen_stats["skipped"] = msg
        elif llm.remaining()["family"] < args.min_remaining:
            gen_stats["skipped"] = "budget"
        else:
            try:
                for t in range(1, args.tranche + 1):
                    gen_stats[f"t{t}"] = generate(order, t, llm, root)
            except QuotaError as e:
                gen_stats["quota_error"] = str(e)
    records, asm = assemble(all_sections, root)
    near_dups = dedup(records)
    kept = [r for r in records if rules.passed(r["checks"])]
    judged = [r for r in kept if r.get("judge")]
    final = [r for r in judged if r["judge"]["passed"]]
    hard_negatives(final, all_sections)
    verdicts = {r["id"]: r["judge"] for r in judged}
    rec_by_id = {r["id"]: r for r in judged}
    check_fail = Counter()
    for r in records:
        for c, ok in r["checks"].items():
            check_fail[c] += not ok
    rows = release_rows(final, all_sections)
    for split, items in rows.items():
        for i in range(0, len(items), 20_000):
            io.write_release_shard(FAMILY, split, i // 20_000, items[i : i + 20_000])
    jm = judge_metrics(verdicts, rec_by_id)
    lang = Counter(r["language"] for r in final)
    usage = llm.ledger.summary() if hasattr(llm.ledger, "summary") else None
    metrics = {
        "family": FAMILY,
        "git_sha": io.git_sha(),
        "sections_total": len(all_sections),
        "sections_eligible": len(sections),
        "sections_planned": len(order),
        "generation": gen_stats,
        "assembly": asm,
        "generated": len(records),
        "rule_failures": dict(check_fail),
        "near_duplicates": near_dups,
        "after_rules": len(kept),
        "judged": len(judged),
        "unjudged_dropped": len(kept) - len(judged),
        "judge": jm,
        "judge_dropped": len(judged) - len(final),
        "final": len(final),
        "by_split": {k: len(v) for k, v in rows.items()},
        "by_language": dict(lang),
        "by_difficulty": dict(Counter(r["difficulty"] for r in final)),
        "by_style": dict(Counter(r["style"] for r in final)),
        "by_act": dict(Counter(r["act"] for r in final)),
        "absatz_coverage": round(sum(bool(r["absatz"]) for r in final) / len(final), 4)
        if final
        else None,
        "bm25_rank_de": _rank_stats([r["bm25_rank"] for r in final]),
        "budget_remaining": llm.remaining(),
        "ledger": usage,
        "elapsed_s": round(time.time() - started, 1),
    }
    judge_txt = (
        f"judge pass rate {jm['pass_rate']} (n = {jm['n']}, 95 % CI {jm['pass_rate_ci95']})"
        if jm["n"]
        else "judge pending"
    )
    io.write_card(
        FAMILY,
        CARD.format(
            sections=len(sections),
            judge=judge_txt,
            rows=len(final),
            by_lang=", ".join(f"{k} {v}" for k, v in lang.most_common()),
            attribution=ATTRIBUTION,
        ),
    )
    _, path = io.write_metrics(FAMILY, metrics)
    print(
        json.dumps({k: metrics[k] for k in ("generated", "after_rules", "final", "by_split")}),
        file=sys.stderr,
    )
    print(f"metrics: {path}", file=sys.stderr)
    return 0


def _rank_stats(ranks: list[int | None]) -> dict:
    found = sorted(r for r in ranks if r is not None)
    if not found:
        return {}
    n = len(ranks)
    return {
        "no_overlap": n - len(found),
        "recall@1": round(sum(r <= 1 for r in found) / n, 4),
        "recall@10": round(sum(r <= 10 for r in found) / n, 4),
        "recall@100": round(sum(r <= 100 for r in found) / n, 4),
        "median": found[len(found) // 2],
    }


if __name__ == "__main__":
    raise SystemExit(main())
