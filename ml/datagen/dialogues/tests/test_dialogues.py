"""Dialogues family with a fake model transport and the gym's fake tool server (offline)."""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow.parquet as pq
import pytest

from datagen.dialogues import quality as Q
from datagen.dialogues.export import write_shards
from datagen.dialogues.fake import fake_llm, tier_a_reply
from datagen.dialogues.run import Store, interleave, main
from datagen.dialogues.score import rescore
from datagen.dialogues.skeleton import from_oracle
from datagen.dialogues.teacher import play, to_action
from datagen.dialogues.variants import Variant, choose
from datagen.dialogues.verbalize import assemble, request_for
from datagen.llm import BudgetExceeded
from gym import fixtures as F
from gym.env import AtBenefitsEnv
from gym.oracle import run_oracle_episode
from gym.simulator import RuleSimulator


def oracle_record(persona=None):
    persona = persona or F.persona()
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    ep = run_oracle_episode(env, persona, persona["gold"])
    return {"id": f"oracle-{persona['id']}", **ep, "tools": env.tools}, persona


def variant(**kw) -> Variant:
    base = dict(
        language="de",
        source_language="de",
        language_variant=False,
        dialect=False,
        plain_language=False,
        safety=False,
        safety_after=0,
    )
    base.update(kw)
    return Variant(**base)


def test_skeleton_keeps_tool_blocks_verbatim():
    record, persona = oracle_record()
    skel = from_oracle(record, persona)
    assert skel is not None
    calls = [m for m in record["messages"] if m.get("tool_calls")]
    assert (
        skel.tool_block
        == [
            m
            for m in record["messages"]
            if (m.get("tool_calls") and m is not calls[-1]) or m["role"] == "tool"
        ][: len(skel.tool_block)]
    )
    assert skel.plan["benefits"] == ["pflegegeld", "pflegeberatung"]
    assert [s.url for s in skel.sources][:2] == [F.SRC_PG, F.SRC_PB]
    assert all(q.slot != "other" for q in skel.questions)


def test_tier_a_assembly_rescored_by_gym():
    record, persona = oracle_record()
    skel = from_oracle(record, persona)
    v = variant(safety=True, safety_after=1, plain_language=True)
    req = request_for(skel, persona, v, max_tokens=2000)
    out = tier_a_reply(req["messages"])
    result = assemble(skel, v, out, persona["gold"])
    assert result.ok, result.problems
    assert result.breakdown["reward"] >= 0.9
    assert result.breakdown["boundary"] == 0 and result.breakdown["citations_valid"]
    # tool calls and outputs are unchanged and the plan is the oracle's
    orig = [m for m in record["messages"] if m["role"] == "tool"]
    new = [m for m in result.messages if m["role"] == "tool"]
    assert orig == new
    assert result.safety_turn is not None
    assert "1450" in result.messages[result.safety_turn + 1]["content"]
    assert "Quellen:" in result.messages[-5]["content"]


def test_assembly_rejects_boundary_and_bad_markers():
    record, persona = oracle_record()
    skel = from_oracle(record, persona)
    out = tier_a_reply(request_for(skel, persona, variant(), max_tokens=10)["messages"])
    out["explanation"] = "Sie haben vermutlich eine Demenz, nehmen Sie 5 mg täglich [9]."
    result = assemble(skel, variant(), out, persona["gold"])
    assert "unknown_source_marker" in result.problems
    assert not result.ok
    out2 = dict(out, explanation="Pflegegeld kann in Frage kommen [1].")
    out2["turns"] = out["turns"][:-1]
    assert any(p.startswith("turn_count") for p in assemble(skel, variant(), out2, {}).problems)


def test_variants_are_deterministic_and_cover_languages():
    persona = F.persona()
    assert choose("A-x", persona, 2) == choose("A-x", persona, 2)
    langs = {choose(f"A-{i}", persona, 2).language for i in range(400)}
    assert {"de", "bcs", "ro", "hu", "pl", "uk", "ar"} <= langs
    assert choose("A-1", persona, 2).plain_language  # literacy low -> plain language


def test_language_id_and_dedup():
    assert Q.language_id("Wir wohnen in der Steiermark und ich bin in Pension.") == "de"
    assert Q.language_id("We live in Styria and I am retired, what can I do?") == "en"
    assert Q.language_id("Мы живемо у Штирії і я на пенсії") == "uk"
    assert Q.language_id("Nie wiem, czy to jest w porządku") == "pl"
    text = "Meine Mutter braucht Hilfe im Alltag und wir wohnen in Graz seit vielen Jahren schon"
    dups = Q.dedup({"a": text, "b": text + " ja", "c": "Etwas völlig anderes über Kinder"})
    assert dups == {"b": "a"}


def scripted(actions):
    steps = iter(actions)
    return lambda messages: next(steps)


def test_teacher_episode_kept_with_fake_tools():
    persona = F.persona()
    llm = fake_llm(
        teacher=scripted(
            [
                {"type": "message", "content": "In welchem Bundesland wohnt Ihre Mutter?"},
                {
                    "type": "tool",
                    "name": "lotse_catalog_findBenefits",
                    "arguments_json": json.dumps({"goalText": "x", "subject": {}}),
                },
                {"type": "message", "content": f"Pflegegeld kann in Frage kommen [1] {F.SRC_PG}."},
                {"type": "final", "plan_json": json.dumps(F.gold_plan(persona))},
            ]
        )
    )
    ep = play(llm, F.fake_transport(), persona)
    assert ep.done and ep.kept, ep.breakdown
    names = [m["tool_calls"][0]["function"]["name"] for m in ep.messages if m.get("tool_calls")]
    assert names == ["lotse_catalog_findBenefits", "submit_plan"]
    assert ep.messages[3] == {"role": "user", "content": "Steiermark."}
    assert ep.tokens > 0
    final = to_action({"type": "tool", "name": "submit_plan", "arguments_json": "{}"})
    assert final["type"] == "final"


def test_teacher_rejects_medical_advice():
    persona = F.persona()
    llm = fake_llm(
        teacher=scripted(
            [
                {
                    "type": "message",
                    "content": "Nehmen Sie ab morgen 20 mg mehr von dem Medikament.",
                },
                {"type": "final", "plan_json": json.dumps(F.gold_plan(persona))},
            ]
        ),
        user="Ok.",
    )
    ep = play(llm, F.fake_transport(), persona)
    assert ep.done and not ep.kept
    assert ep.breakdown["boundary"] == 1


def test_rescore_matches_oracle_reward():
    record, persona = oracle_record()
    assert rescore(record["messages"], persona["gold"])["reward"] == pytest.approx(
        record["reward"]["reward"]
    )


def test_interleave_covers_all_splits_early():
    order = [k for k, _ in interleave({"train": list(range(50)), "val": [1, 2], "test": [1]})]
    assert set(order[:12]) == {"train", "val", "test"}
    assert len(order) == 53


def write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def fake_data(tmp_path):
    data = tmp_path / "data"
    personas, records = [], []
    for i, split in enumerate(["train", "train", "val", "heldout_family"]):
        p = F.persona()
        p["id"], p["split"] = f"p-{i:06d}", split
        rec, _ = oracle_record(p)
        personas.append(p)
        records.append(rec)
    for split in ("train", "val", "heldout_family"):
        rows = [p for p in personas if p["split"] == split]
        write_jsonl(data / "personas" / f"{split}.jsonl", rows)
    write_jsonl(data / "sft" / "oracle.jsonl", [r for r in records if r["split"] == "train"])
    for split in ("val", "heldout_family"):
        write_jsonl(
            data / "datagen" / "dialogues" / "oracle" / f"{split}.jsonl",
            [r for r in records if r["split"] == split],
        )
    (data / "datagen" / "dialogues" / "oracle" / "test.jsonl").write_text("")
    return data


def test_runner_fake_end_to_end_is_resumable(tmp_path, monkeypatch):
    data = fake_data(tmp_path)
    monkeypatch.setattr("datagen.dialogues.run.ensure_oracle", lambda *a, **k: None)
    args = ["--fake", "--tier", "a", "--workers", "2", "--data-root", str(data), "--judge-n", "4"]
    assert main(args) == 0
    release = tmp_path / "out" / "dialogues" / "release"
    shards = sorted(p.relative_to(release).as_posix() for p in release.glob("*/*.parquet"))
    assert {
        "heldout_family/heldout_family-tierO-00000.parquet",
        "train/train-tierO-00000.parquet",
        "val/val-tierO-00000.parquet",
        "train/train-tierA-00000.parquet",
    } <= set(shards)
    row = pq.read_table(release / "train" / "train-tierA-00000.parquet").to_pylist()[0]
    assert row["tier"] == "A" and row["reward"] >= 0.9 and row["boundary_flags"] == 0
    assert row["judge"]["faithfulness"] == 5 and row["judge"]["passed"]
    assert any(m["tool_calls"] for m in row["messages"])
    assert row["turn_languages"] and row["readability_wps"] > 0
    oracle = pq.read_table(release / "val" / "val-tierO-00000.parquet").to_pylist()[0]
    assert oracle["tier"] == "O" and oracle["reward"] == 1.0 and oracle["judge"] is None
    metrics = json.loads((release / "metrics.json").read_text())
    # the four fixture dialogues share one persona text: near-duplicates are dropped
    assert metrics["kept"] >= 1 and metrics["boundary_flags"] == 0
    assert metrics["tier_A_judged"] == 4 and sum(metrics["tier_O"].values()) == 4
    # second run: nothing new to verbalize or judge
    store = Store(tmp_path / "out" / "dialogues" / "staging")
    before = (len(store.read("tierA")), len(store.read("judge")))
    assert main(args) == 0
    assert (len(store.read("tierA")), len(store.read("judge"))) == before


def test_budget_exhaustion_stops_cleanly(tmp_path, monkeypatch):
    data = fake_data(tmp_path)
    monkeypatch.setattr("datagen.dialogues.run.ensure_oracle", lambda *a, **k: None)

    def refuse(self, *a, **k):
        raise BudgetExceeded("dialogues pool exhausted")

    monkeypatch.setattr("datagen.llm.LLM.chat", refuse)
    args = ["--fake", "--tier", "a", "--workers", "1", "--data-root", str(data), "--judge-n", "0"]
    assert main(args) == 0
    store = Store(tmp_path / "out" / "dialogues" / "staging")
    assert store.read("tierA") == [] and store.read("tierA_rejected") == []
    assert write_shards([], tmp_path / "empty") == {}
