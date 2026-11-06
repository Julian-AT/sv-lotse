import json

from eval.scoring import parse_last_plan, parse_plan, score_plan
from rl.train import flatten
from sft.data import gold_plan, load_personas, persona_card, plan_example
from sft.masking import IGNORE, assistant_spans, tokenize_example

PERSONA = {
    "id": "p-1",
    "split": "test",
    "household": [{"role": "subject", "age": 74}],
    "situation_text": "Meine Mutter kommt allein nicht mehr zurecht.",
    "noise": {"dialect": 0.5},
    "gold": {
        "benefits": ["pflegegeld"],
        "offices": {"pflegegeld": "pva-stmk"},
        "documents": {"pflegegeld": ["antrag"]},
        "min_questions": 4,
    },
}


def test_persona_card_hides_gold_and_noise():
    card = persona_card(PERSONA)
    assert "gold" not in card and "noise" not in card and "split" not in card
    prompt = json.dumps(plan_example(PERSONA)["messages"][:-1], ensure_ascii=False)
    assert "pva-stmk" not in prompt


def test_gold_plan_maps_gold_fields():
    plan = gold_plan(PERSONA["gold"])
    assert plan["office_per_benefit"] == {"pflegegeld": "pva-stmk"}
    assert plan["documents_per_benefit"] == {"pflegegeld": ["antrag"]}


def test_load_personas_filters_split(tmp_path):
    f = tmp_path / "personas.jsonl"
    f.write_text(json.dumps(PERSONA) + "\n" + json.dumps({**PERSONA, "split": "train"}) + "\n")
    assert len(load_personas(f, ["test"])) == 1


def test_persona_dir_reads_each_split_once(tmp_path):
    import pandas as pd

    (tmp_path / "test.jsonl").write_text(json.dumps(PERSONA) + "\n")
    pd.DataFrame([PERSONA]).to_parquet(tmp_path / "test.parquet")
    assert len(load_personas(tmp_path, ["test"])) == 1


def test_assistant_spans_cover_turn_and_end_marker():
    text = "<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\nok<|im_end|>\n"
    (s, e) = assistant_spans(text, "<|im_start|>assistant\n", "<|im_end|>")[0]
    assert text[s:e] == "ok<|im_end|>"


class CharTokenizer:
    def apply_chat_template(self, messages, tokenize=False, **_):
        return "".join(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>\n" for m in messages)

    def __call__(self, text, add_special_tokens=False, return_offsets_mapping=False):
        return {
            "input_ids": [ord(c) for c in text],
            "offset_mapping": [(i, i + 1) for i in range(len(text))],
        }


def test_only_assistant_tokens_are_trained():
    ex = plan_example(PERSONA)
    row = tokenize_example(ex, CharTokenizer(), 100_000)
    trained = "".join(chr(t) for t in row["labels"] if t != IGNORE)
    assert trained == ex["messages"][-1]["content"] + "<|im_end|>"


def test_parse_plan_variants():
    assert parse_plan('<think>{"benefits": 1}</think>no plan') is None
    text = '{"name": "x"} {"benefits": ["a"]} {"benefits": ["b"]}'
    assert parse_plan(text) == {"benefits": ["a"]}
    assert parse_last_plan(text) == {"benefits": ["b"]}


def test_score_plan_uses_gym_reward():
    gold_plan_json = gold_plan(PERSONA["gold"])
    good = score_plan(gold_plan_json, PERSONA, agent_messages=["Plan siehe JSON."])
    none = score_plan(None, PERSONA)
    assert good["reward"] > none["reward"]
    assert good["f1_benefits"] == 1.0 and none["no_plan"] is True


def test_flatten_to_hydra_overrides():
    assert flatten({"a": {"b": 1, "c": [1, 2]}}) == ["a.b=1", "a.c=[1, 2]"]
