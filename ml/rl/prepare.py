"""Build verl inputs: persona parquet files and the tool config from the research tool server.

    uv run python -m rl.prepare --personas data/personas --out data/rl \
        --tool-server http://127.0.0.1:8787
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import httpx
import pandas as pd
import yaml

from sft.data import load_personas, persona_card

SYSTEM = (
    "Du bist SV-Lotse. Kläre mit möglichst wenigen Fragen, welche Leistungen der Person zustehen, "
    "nutze die Werkzeuge und antworte am Ende mit dem finalen Plan als JSON. Keine medizinischen "
    "Diagnosen oder Therapieempfehlungen."
)


def rows(personas: list[dict], split: str) -> list[dict]:
    out = []
    for p in personas:
        out.append(
            {
                "data_source": "at_benefits",
                "prompt": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": p.get("situation_text", "")},
                ],
                "reward_model": {"style": "rule", "ground_truth": json.dumps(p["gold"])},
                "extra_info": {
                    "persona_id": p.get("id"),
                    "split": split,
                    "interaction_kwargs": {
                        "name": "gym_user",
                        "persona": json.dumps(
                            persona_card(p) | {"situation_text": p.get("situation_text", "")},
                            ensure_ascii=False,
                        ),
                    },
                },
            }
        )
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--personas", type=Path, default=Path("data/personas"))
    ap.add_argument("--out", type=Path, default=Path("data/rl"))
    ap.add_argument("--tool-server", default="http://127.0.0.1:8787")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for split in ("train", "val"):
        df = pd.DataFrame(rows(load_personas(args.personas, [split]), split))
        df.to_parquet(args.out / f"{split}.parquet")
    tools = httpx.get(f"{args.tool_server}/tools", timeout=10).json()
    cfg = {
        "tools": [
            {
                "class_name": "rl.interaction.BrainTool",
                "config": {"type": "native", "server_url": args.tool_server},
                "tool_schema": {"type": "function", "function": t},
            }
            for t in tools
        ]
    }
    (Path(__file__).parent / "tools.yaml").write_text(yaml.safe_dump(cfg, allow_unicode=True))


if __name__ == "__main__":
    main()
