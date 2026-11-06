"""HF source: tool-output compaction, row conversion and the length filter (no network)."""

import json

import numpy as np

from sft.data import (
    compact_json_text,
    compact_messages,
    examples_from_rows,
    filter_by_length,
    persona_from_situation,
)

BENEFITS = [
    {"id": f"benefit-{i}", "title": f"Leistung {i}", "description": "x" * 900} for i in range(30)
]
TOOL_OUTPUT = json.dumps({"ok": True, "output": BENEFITS})
PLAN_ARGS = json.dumps(
    {"benefits": ["benefit-1"], "citations": ["https://example.at/" + "a" * 3000]}
)


def row(tier="O", split="train", tool=TOOL_OUTPUT):
    msgs = [
        {"role": "system", "content": "sys", "tool_calls": None, "tool_call_id": None},
        {"role": "user", "content": "Hilfe", "tool_calls": None, "tool_call_id": None},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": np.array(
                [{"id": "c1", "type": "function", "function": {"name": "find", "arguments": "{}"}}],
                dtype=object,
            ),
            "tool_call_id": None,
        },  # fmt: skip
        {"role": "tool", "content": tool, "tool_calls": None, "tool_call_id": "c1"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "c2",
                    "type": "function",
                    "function": {"name": "submit_plan", "arguments": PLAN_ARGS},
                }
            ],
            "tool_call_id": None,
        },  # fmt: skip
        {"role": "tool", "content": '{"ok": true}', "tool_calls": None, "tool_call_id": "c2"},
    ]
    return {
        "id": f"{tier}-p-1-{split}",
        "tier": tier,
        "split": split,
        "messages": np.array(msgs, dtype=object),
        "tools": json.dumps([{"type": "function", "function": {"name": "find"}}]),
    }


def test_compaction_keeps_valid_json_and_every_id():
    out = compact_json_text(TOOL_OUTPUT, 1500)
    assert len(out) <= 1500
    data = json.loads(out)
    assert [b["id"] for b in data["output"]] == [b["id"] for b in BENEFITS]


def test_compaction_short_output_unchanged_and_plain_text_cut():
    assert compact_json_text('{"ok": true}', 1500) == '{"ok": true}'
    cut = compact_json_text("y" * 5000, 200)
    assert len(cut) <= 200 and cut.endswith("chars cut]")


def test_compaction_falls_back_to_valid_preview():
    huge = json.dumps({"output": [{"id": "z" * 50} for _ in range(400)]})
    out = compact_json_text(huge, 300)
    assert len(out) <= 300 and json.loads(out)["truncated"] is True


def test_last_assistant_turn_and_plan_are_never_cut():
    msgs = compact_messages(examples_from_rows([row()], tool_max_chars=0)[0]["messages"], 100)
    plan_call = msgs[4]["tool_calls"][0]["function"]["arguments"]
    assert plan_call == PLAN_ARGS
    assert len(msgs[3]["content"]) <= 100
    assert msgs[5]["content"] == '{"ok": true}'


def test_rows_keep_split_and_filter_tiers():
    rows = [row("O", "train"), row("A", "val"), row("C", "train")]
    ex = examples_from_rows(rows, tiers=["O", "A"], splits=["train", "val"])
    assert [(e["tier"], e["split"]) for e in ex] == [("O", "train"), ("A", "val")]
    first = ex[0]["messages"]
    assert "tool_calls" not in first[0] and "tool_call_id" not in first[1]
    assert isinstance(first[2]["tool_calls"], list) and first[2]["content"] == ""
    assert ex[0]["tools"][0]["function"]["name"] == "find"
    assert len(first[3]["content"]) <= 1500


def test_length_filter_reports_drops():
    examples = [{"id": i, "n": n} for i, n in enumerate([10, 50, 8000, 9000])]
    kept, report = filter_by_length(examples, lambda e: e["n"], 8192)
    assert [e["id"] for e in kept] == [0, 1, 2]
    assert report["dropped"] == 1 and report["dropped_ids_sample"] == [3]
    assert report["longest_kept_tokens"] == 8000


def test_situation_row_parses_json_fields_and_drops_extras():
    persona = persona_from_situation(
        {
            "id": "p-1",
            "split": "test",
            "household": json.dumps([{"role": "subject", "age": 30}]),
            "gold": json.dumps({"benefits": ["a"]}),
            "noise": json.dumps({"dialect": 0.0}),
            "gold_benefits": np.array(["a"]),
            "situation_text": "Hallo",
        }
    )
    assert persona["gold"] == {"benefits": ["a"]} and persona["household"][0]["age"] == 30
    assert "gold_benefits" not in persona
