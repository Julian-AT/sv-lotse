"""Runner for the dialogues family (resumable, budget-aware; tier A first, then tier B).

    uv run python -m datagen.dialogues.run --tranche 1 [--data-root ../sv-lotse/ml/data]
    uv run python -m datagen.dialogues.run --fake --limit-a 50      # smoke run, no model calls

State lives in ``<data>/datagen/dialogues/staging`` (kept/rejected JSONL per tier, judge scores,
``state.json``); a rerun skips every finished id. Tier A stops when the family's remaining budget
falls to 12 % of the budget seen on the first run, tier B at 4 %; the judge sample uses the rest.
Finalize (always) re-runs dedup and language checks, writes Parquet shards and the metrics JSON
``ml/results/datagen-dialogues-<sha>.json``.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any

from datagen.dialogues import quality as Q
from datagen.dialogues.client import (
    STOP_ERRORS,
    get_llm,
    parsed_json,
    remaining_tokens,
    usage_tokens,
)
from datagen.dialogues.export import SPLITS, card, metrics, write_shards, write_stream
from datagen.dialogues.skeleton import from_oracle
from datagen.dialogues.variants import choose
from datagen.dialogues.verbalize import PROMPT_VERSION, assemble, request_for
from gym.paths import DATA_DIR, DEFAULT_SERVER, ML_DIR, git_sha

SPLIT_WEIGHTS = {"train": 0.7, "val": 0.1, "test": 0.1, "heldout_family": 0.1}
FLOOR_A, FLOOR_B = 0.12, 0.04
_PID = re.compile(rb'"persona_id":\s*"([^"]+)"')
_ID = re.compile(r'"id":\s*"(p-[^"]+)"')


class Store:
    """Append-only JSONL staging with a lock; the set of finished ids makes runs resumable."""

    def __init__(self, root: Path) -> None:
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def path(self, name: str) -> Path:
        return self.root / f"{name}.jsonl"

    def read(self, name: str) -> list[dict[str, Any]]:
        p = self.path(name)
        if not p.exists():
            return []
        out = []
        with p.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue  # torn last line after a kill
        return out

    def ids(self, *names: str) -> set[str]:
        return {r["id"] for n in names for r in self.read(n)}

    def append(self, name: str, record: dict[str, Any]) -> None:
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with self.lock, self.path(name).open("a", encoding="utf-8") as fh:
            fh.write(line)

    def state(self) -> dict[str, Any]:
        p = self.root / "state.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def save_state(self, state: dict[str, Any]) -> None:
        (self.root / "state.json").write_text(json.dumps(state, indent=2))


# ------------------------------------------------------------------ inputs
def oracle_files(data: Path) -> dict[str, Path]:
    out = {"train": data / "sft" / "oracle.jsonl"}
    for split in ("val", "test", "heldout_family"):
        out[split] = data / "datagen" / "dialogues" / "oracle" / f"{split}.jsonl"
    return {k: v for k, v in out.items() if v.exists()}


def ensure_oracle(data: Path, n: int, server: str, log: Path) -> None:
    """Oracle trajectories for val/test/heldout_family (tool-exact, from the gym oracle)."""
    for split in ("val", "test", "heldout_family"):
        target = data / "datagen" / "dialogues" / "oracle" / f"{split}.jsonl"
        if target.exists() and target.stat().st_size > 0:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            sys.executable,
            "-m",
            "gym.oracle",
            "--personas",
            str(data / "personas" / f"{split}.jsonl"),
            "--split",
            split,
            "--n",
            str(n),
            "--noise",
            "--server",
            server,
            "--out",
            str(target),
        ]
        with log.open("a") as fh:
            subprocess.run(cmd, cwd=ML_DIR, stdout=fh, stderr=fh, check=False)


def index_oracle(path: Path) -> list[tuple[str, int]]:
    """(persona id, byte offset) per trajectory, without parsing the large tool outputs."""
    out, offset = [], 0
    with path.open("rb") as fh:
        for line in fh:
            m = _PID.search(line[:400])
            if m:
                out.append((m.group(1).decode(), offset))
            offset += len(line)
    return out


def read_at(path: Path, offset: int) -> dict[str, Any]:
    with path.open("rb") as fh:
        fh.seek(offset)
        return json.loads(fh.readline())


def load_personas(
    data: Path,
    wanted: dict[str, set[str]] | None,
    *,
    skip: set[str] | None = None,
    max_per_split: int | None = None,
) -> dict[str, dict[str, Any]]:
    """Personas by id: the ``wanted`` ids per split, or (``wanted=None``) up to ``max_per_split``
    per split not in ``skip``. Lines are filtered on the id before the full JSON parse."""
    out: dict[str, dict[str, Any]] = {}
    for split in SPLITS:
        path = data / "personas" / f"{split}.jsonl"
        ids = None if wanted is None else wanted.get(split, set())
        if not path.exists() or ids == set():
            continue
        taken = 0
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                m = _ID.search(line)
                pid = m.group(1) if m else None
                if ids is not None and pid not in ids:
                    continue
                if ids is None and (pid in (skip or set())):
                    continue
                p = json.loads(line)
                out[str(p["id"])] = p
                taken += 1
                if max_per_split is not None and taken >= max_per_split:
                    break
    return out


def interleave(queues: dict[str, list[Any]]) -> Iterator[tuple[str, Any]]:
    """Weighted round-robin over splits so every split is covered early."""
    pos = {k: 0 for k in queues}
    credit = {k: 0.0 for k in queues}
    while any(pos[k] < len(queues[k]) for k in queues):
        for k in queues:
            credit[k] += SPLIT_WEIGHTS.get(k, 0.1)
        k = max((k for k in queues if pos[k] < len(queues[k])), key=lambda s: credit[s])
        credit[k] -= 1.0
        yield k, queues[k][pos[k]]
        pos[k] += 1


def model_name(llm: Any, role: str) -> str:
    """Model id behind a role when the core exposes it (config), else the role name."""
    try:
        from datagen import config as C

        return str(C.default().role(role).get("model") or role)
    except Exception:  # noqa: BLE001
        return role


def check_key(tries: int = 5, wait: float = 30.0) -> bool:
    """``datagen.check_key`` must print OK before paid work; a rate limit (429) is retried."""
    for attempt in range(tries):
        out = subprocess.run(
            [sys.executable, "-m", "datagen.check_key"], cwd=ML_DIR, capture_output=True, text=True
        )
        if out.returncode == 0 and out.stdout.strip().upper().startswith("OK"):
            return True
        if "429" not in out.stdout or attempt == tries - 1:
            return False
        time.sleep(wait * (attempt + 1))
    return False


# ------------------------------------------------------------------ records
def base_record(**fields: Any) -> dict[str, Any]:
    rec = {"git_sha": git_sha(), "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    rec.update(fields)
    return rec


def quality_fields(messages: list[dict[str, Any]], language: str) -> dict[str, Any]:
    q = Q.turn_languages(messages, language)
    pilot = " ".join(
        m["content"] for m in messages if m.get("role") == "assistant" and m.get("content")
    )
    return {**q, **Q.readability(pilot, language)}


class Budget:
    def __init__(self, llm: Any, store: Store) -> None:
        self.llm = llm
        state = store.state()
        if "budget_start" not in state:
            state["budget_start"] = remaining_tokens(llm)
            store.save_state(state)
        self.start = state["budget_start"]
        self.exceeded = False

    def above(self, floor: float) -> bool:
        if self.exceeded:
            return False
        left = remaining_tokens(self.llm)
        if left is None or not self.start:
            return True
        return left > floor * self.start


# ------------------------------------------------------------------ tier A
def run_tier_a(args, llm, store: Store, budget: Budget, data: Path) -> None:
    files = oracle_files(data)
    done = store.ids("tierA", "tierA_rejected")
    queues: dict[str, list[tuple[Path, str, int]]] = {}
    for split, path in files.items():
        queues[split] = [
            (path, pid, off) for pid, off in index_oracle(path) if f"A-{pid}" not in done
        ]
    wanted = {s: {pid for _, pid, _ in q} for s, q in queues.items()}
    personas = load_personas(data, wanted)
    work = list(interleave(queues))
    if args.limit_a is not None:
        work = work[: args.limit_a]
    print(f"tier A: {len(work)} skeletons to verbalize", flush=True)
    stop = threading.Event()

    def one(item: tuple[str, tuple[Path, str, int]]) -> None:
        if stop.is_set():
            return
        split, (path, pid, offset) = item
        persona = personas.get(pid)
        if persona is None:
            return
        skel = from_oracle(read_at(path, offset), persona)
        if skel is None:
            return
        rid = f"A-{pid}"
        variant = choose(rid, persona, len(skel.questions))
        req = request_for(skel, persona, variant, max_tokens=args.max_tokens_a)
        tokens, problems, assembled, verdict = 0, ["no_attempt"], None, None
        for attempt in range(2):
            messages = req["messages"]
            if attempt:  # a different request body (the core caches identical ones)
                note = "Your previous answer was rejected: " + ", ".join(problems)
                messages = [
                    {"role": "system", "content": messages[0]["content"] + "\n" + note},
                    messages[1],
                ]
            try:
                result = llm.chat(
                    messages,
                    role="bulk",
                    response_format=req["response_format"],
                    max_output_tokens=req["max_output_tokens"],
                )
            except STOP_ERRORS:
                budget.exceeded = True
                stop.set()
                return
            tokens += usage_tokens(result)
            try:
                out = parsed_json(result)
            except (ValueError, TypeError) as exc:
                problems = ["llm_error" if "llm error" in str(exc) else "unparseable"]
                continue
            assembled = assemble(skel, variant, out, persona["gold"])
            problems = assembled.problems
            if not assembled.ok:
                continue
            if not args.judge_each:
                break
            try:
                verdict = Q.judge_one(
                    llm,
                    {"id": rid, "messages": assembled.messages, **variant.as_dict()},
                )
            except STOP_ERRORS:
                budget.exceeded = True
                stop.set()
                return
            if verdict.get("passed"):
                break
            problems = ["judge_failed: " + str(verdict.get("reason"))[:300]]
            assembled.problems = problems
        common = dict(
            id=rid,
            tier="A",
            persona_id=pid,
            split=split,
            **variant.as_dict(),
            safety_injected=variant.safety,
            model=model_name(llm, "bulk"),
            prompt_version=PROMPT_VERSION,
            tokens=tokens,
        )
        if assembled is None or not assembled.ok:
            store.append("tierA_rejected", base_record(**common, problems=problems, judge=verdict))
            return
        store.append(
            "tierA",
            base_record(
                **common,
                messages=assembled.messages,
                tools=skel.tools,
                plan=skel.plan,
                reward=assembled.breakdown["reward"],
                reward_breakdown=assembled.breakdown,
                boundary_flags=assembled.breakdown["boundary"],
                citations_valid=assembled.breakdown["citations_valid"],
                safety_turn=assembled.safety_turn,
                judge=verdict,
                **quality_fields(assembled.messages, variant.language),
            ),
        )

    run_pool(work, one, args.workers, stop, lambda: budget.above(args.floor_a), "tier A")


def run_pool(work, fn, workers: int, stop: threading.Event, ok, label: str) -> None:
    done = 0
    with ThreadPoolExecutor(workers) as pool:
        it = iter(work)
        pending = set()
        while True:
            while len(pending) < workers * 2 and not stop.is_set():
                item = next(it, None)
                if item is None:
                    break
                pending.add(pool.submit(fn, item))
            if not pending:
                break
            finished, pending = wait(pending, return_when=FIRST_COMPLETED)
            for f in finished:
                if f.exception():
                    print(f"{label}: error {f.exception()!r}", file=sys.stderr, flush=True)
            done += len(finished)
            if done % 50 < len(finished):
                print(f"{label}: {done} done", flush=True)
                if not ok():
                    print(f"{label}: budget floor reached, stopping", flush=True)
                    stop.set()


# ------------------------------------------------------------------ tier B
def run_tier_b(args, llm, store: Store, budget: Budget, data: Path) -> None:
    from datagen.dialogues.teacher import catalog_context, play
    from gym.transport import HttpTransport

    if not HttpTransport(args.server).health():
        print(f"tier B: tool server not reachable at {args.server}; skipped", flush=True)
        return
    context = catalog_context(HttpTransport(args.server).catalog_summary())
    done = store.ids("tierB", "tierB_rejected")
    used = {pid for p in oracle_files(data).values() for pid, _ in index_oracle(p)}
    personas = load_personas(
        data, None, skip=used | {d[2:] for d in done}, max_per_split=args.persona_pool_b
    )
    queues: dict[str, list[dict[str, Any]]] = {s: [] for s in SPLITS}
    for p in personas.values():
        small = len((p.get("gold") or {}).get("benefits") or []) <= args.max_bundle_b
        if (
            small
            and p["id"] not in used
            and f"B-{p['id']}" not in done
            and p.get("split") in queues
        ):
            queues[p["split"]].append(p)
    work = [p for _, p in interleave(queues)]
    if args.limit_b is not None:
        work = work[: args.limit_b]
    print(f"tier B: {len(work)} personas available", flush=True)
    stop = threading.Event()

    def one(persona: dict[str, Any]) -> None:
        if stop.is_set():
            return
        from gym import slots as S

        try:
            ep = play(llm, HttpTransport(args.server), persona, context=context)
        except STOP_ERRORS:
            budget.exceeded = True
            stop.set()
            return
        lang = S.language(persona)
        common = dict(
            id=f"B-{persona['id']}",
            tier="B",
            persona_id=persona["id"],
            split=persona["split"],
            language=lang,
            source_language=lang,
            language_variant=False,
            dialect=False,
            plain_language=False,
            safety_injected=False,
            model=model_name(llm, "strong"),
            prompt_version="dialogues-tierB-v1",
            tokens=ep.tokens,
        )
        if not ep.kept:  # rejected episodes stay in staging only (never in the release)
            store.append(
                "tierB_rejected",
                base_record(
                    **common,
                    problems=["not_kept"],
                    reward=ep.breakdown.get("reward"),
                    reward_breakdown=ep.breakdown,
                    messages=ep.messages,  # kept for analysis and preference pairs
                ),
            )
            return
        from datagen.dialogues.score import plan_of

        store.append(
            "tierB",
            base_record(
                **common,
                messages=ep.messages,
                tools=[],
                plan=plan_of(ep.messages),
                reward=ep.breakdown["reward"],
                reward_breakdown=ep.breakdown,
                boundary_flags=ep.breakdown["boundary"],
                citations_valid=True,
                **quality_fields(ep.messages, lang),
            ),
        )

    run_pool(work, one, args.workers_b, stop, lambda: budget.above(args.floor_b), "tier B")


# ------------------------------------------------------------------ finalize
def oracle_rows(data: Path) -> Iterator[dict[str, Any]]:
    """Tier O: the gym oracle's tool-exact trajectories as they are (template text, reward 1.0)."""
    from datagen.dialogues.score import plan_of

    for split, path in oracle_files(data).items():
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                rec = json.loads(line)
                lang = str(rec.get("language") or "de")
                yield base_record(
                    id=f"O-{rec['persona_id']}",
                    tier="O",
                    persona_id=rec["persona_id"],
                    split=rec.get("split") or split,
                    language=lang,
                    source_language=lang,
                    language_variant=False,
                    dialect=False,
                    plain_language=False,
                    safety_injected=False,
                    messages=rec["messages"],
                    tools=rec.get("tools") or [],
                    plan=plan_of(rec["messages"]),
                    reward=rec["reward"]["reward"],
                    reward_breakdown=rec["reward"],
                    boundary_flags=rec["reward"]["boundary"],
                    citations_valid=rec["reward"]["cite_valid"] >= 1.0,
                    model="gym-oracle",
                    prompt_version="oracle-templates",
                    tokens=0,
                    **quality_fields(rec["messages"], lang),
                )


def rejudge(args, llm, store: Store, name: str) -> None:
    """Judge an older unjudged staging file (earlier prompt versions); passing rows go to
    ``tierA_rejudged``, the verdict of every row to ``rejudge_verdicts``."""
    done = store.ids("tierA_rejudged", "rejudge_verdicts")
    rows = [r for r in store.read(name) if r["id"] not in done]
    print(f"rejudge: {len(rows)} rows from {name}", flush=True)
    stop = threading.Event()

    def one(row: dict[str, Any]) -> None:
        if stop.is_set():
            return
        try:
            verdict = Q.judge_one(llm, row)
        except STOP_ERRORS:
            stop.set()
            return
        store.append("rejudge_verdicts", {"id": row["id"], **verdict})
        if verdict.get("passed"):
            store.append("tierA_rejudged", {**row, "judge": verdict})

    run_pool(rows, one, args.workers, stop, lambda: True, "rejudge")


def finalize(args, llm, store: Store, release: Path, data: Path) -> dict[str, Any]:
    records = store.read("tierA") + store.read("tierA_rejudged") + store.read("tierB")
    rejects = store.read("tierA_rejected") + store.read("tierB_rejected")
    records = list({r["id"]: r for r in records}.values())  # last write wins on resume
    judged = {r["id"]: r for r in store.read("judge")}
    judged.update({r["id"]: r["judge"] for r in records if r.get("judge")})
    todo = [r for r in records if r["tier"] == "A" and r["id"] not in judged]
    if args.judge_n:
        todo += [r for r in Q.stratified_sample(records, args.judge_n) if r["id"] not in judged]
    if todo:  # judge rows generated without the inline judge (resumed or older runs)
        print(f"judge: {len(todo)} dialogues", flush=True)
        try:
            for rid, verdict in Q.judge_rows(
                llm, list({r["id"]: r for r in todo}.values())
            ).items():
                store.append("judge", {"id": rid, **verdict})
                judged[rid] = verdict
        except STOP_ERRORS:
            print("judge: budget exhausted", flush=True)
    for r in records:
        r["judge"] = judged.get(r["id"])
    judge_attempts = [r.get("judge") for r in records + rejects if isinstance(r.get("judge"), dict)]
    released = [r for r in records if r["tier"] != "A" or (r.get("judge") or {}).get("passed")]
    dups = Q.dedup({r["id"]: Q.dialogue_text(r["messages"]) for r in released})
    released = [r for r in released if r["id"] not in dups]
    for r in released:
        r["near_duplicate_of"] = None
    records = released
    counts = write_shards(records, release)
    oracle_counts = write_stream(oracle_rows(data), release, "O") if args.with_oracle else {}
    counts.update(oracle_counts)
    size = sum(p.stat().st_size for p in release.glob("*/*.parquet"))
    try:
        ledger = llm.ledger.summary()
    except Exception:  # noqa: BLE001
        ledger = None
    m = metrics(
        records,
        rejects,
        {
            "tranche": args.tranche,
            "tier_O": oracle_counts,
            "tier_A_judged": len(judge_attempts),
            "tier_A_judge_pass_rate_all_attempts": round(
                sum(bool(j.get("passed")) for j in judge_attempts) / len(judge_attempts), 4
            )
            if judge_attempts
            else None,
            "near_duplicates_dropped": len(dups),
            "shards": counts,
            "parquet_bytes": size,
            "git_sha": git_sha(),
            "budget_start_tokens": store.state().get("budget_start"),
            "budget_remaining_tokens": remaining_tokens(llm),
            "ledger": ledger,
        },
    )
    if oracle_counts:
        m["per_tier"]["O"] = sum(oracle_counts.values())
    m["release_rows"] = m["kept"] + sum(oracle_counts.values())
    if args.fake:
        path = release / "metrics.json"
        path.write_text(json.dumps(m, indent=2, ensure_ascii=False, default=str))
    else:
        from datagen.io import write_card, write_metrics

        write_card("dialogues", card(m))
        _, path = write_metrics("dialogues", m)
    print(json.dumps({k: m[k] for k in ("kept", "rejected", "per_tier", "per_language")}))
    print(f"metrics -> {path}")
    return m


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--tranche", type=int, default=1)
    ap.add_argument("--data-root", type=Path, default=DATA_DIR, help="personas and oracle input")
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--tier", choices=["a", "b", "all", "none"], default="all")
    ap.add_argument("--limit-a", type=int)
    ap.add_argument("--limit-b", type=int)
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--workers-b", type=int, default=6)
    ap.add_argument("--max-tokens-a", type=int, default=4000)
    ap.add_argument("--oracle-n", type=int, default=2000)
    ap.add_argument("--persona-pool-b", type=int, default=3000)
    ap.add_argument(
        "--max-bundle-b", type=int, default=6, help="tier B curriculum: gold bundle size limit"
    )
    ap.add_argument("--judge-n", type=int, default=0, help="extra judged sample (finalize)")
    ap.add_argument(
        "--no-judge-each",
        dest="judge_each",
        action="store_false",
        help="skip the per-dialogue judge in tier A (default: judge every dialogue, keep passing)",
    )
    ap.add_argument("--floor-a", type=float, default=FLOOR_A, help="stop tier A at this share")
    ap.add_argument("--floor-b", type=float, default=FLOOR_B, help="stop tier B at this share")
    ap.add_argument("--rejudge", help="judge an older staging file (e.g. tierA-v3-unjudged)")
    ap.add_argument("--no-oracle-tier", dest="with_oracle", action="store_false")
    ap.add_argument("--fake", action="store_true", help="fake model transport, no network")
    args = ap.parse_args(argv)

    data = args.data_root.resolve()
    log = data / "datagen" / "logs" / "dialogues-oracle.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    if args.fake:
        from datagen import config as C

        os.environ.setdefault("DATAGEN_ROOT", str(data / "datagen-fake"))
        C.default.cache_clear()
        from datagen.dialogues.fake import fake_llm

        llm = fake_llm()
    else:
        if args.tier != "none" and not check_key():
            print("datagen.check_key is not OK; no paid work started", file=sys.stderr)
            return 3
        llm = get_llm("dialogues")
    from datagen.io import family_dir, release_dir

    store = Store(family_dir("dialogues") / "staging")
    if args.tier != "none":
        ensure_oracle(data, args.oracle_n, args.server, log)
    budget = Budget(llm, store)
    if args.rejudge:
        rejudge(args, llm, store, args.rejudge)
    if args.tier in ("a", "all"):
        run_tier_a(args, llm, store, budget, data)
    if args.tier in ("b", "all") and not args.fake:
        run_tier_b(args, llm, store, budget, data)
    finalize(args, llm, store, release_dir("dialogues"), data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
