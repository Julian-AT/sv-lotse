"""AT-Benefits v1, family ``dialogues``: multi-turn, tool-exact pilot dialogues.

Tier A verbalizes gym oracle trajectories (tool calls, tool outputs and gold untouched; only the
natural-language turns are written by the bulk model). Tier B keeps teacher episodes played in the
gym with the real tools (rejection sampling as in ``sft.rollout``). Labels always come from the
engine and the gym reward, never from a model.
"""

FAMILY = "dialogues"
