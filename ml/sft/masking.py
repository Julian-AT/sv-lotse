"""Tokenize chat examples with loss on assistant and tool-call tokens only.

The chat is rendered with the model's own template, then every token inside an assistant span
(from the assistant header to its end-of-turn marker, inclusive of the marker) gets a label;
everything else (system, user, tool responses, headers) is -100. Tool calls are part of the
assistant turn in the Qwen3 and EuroLLM (ChatML) templates, so they are trained; tool responses
are rendered as their own turns and are not.
"""

from __future__ import annotations

from typing import Any

IGNORE = -100


def assistant_spans(text: str, start: str, end: str) -> list[tuple[int, int]]:
    spans, pos = [], 0
    while (i := text.find(start, pos)) != -1:
        body = i + len(start)
        j = text.find(end, body)
        stop = len(text) if j == -1 else j + len(end)
        spans.append((body, stop))
        pos = stop
    return spans


def tokenize_example(
    example: dict[str, Any],
    tokenizer: Any,
    max_length: int,
    assistant_start: str = "<|im_start|>assistant\n",
    turn_end: str = "<|im_end|>",
    template_kwargs: dict[str, Any] | None = None,
) -> dict[str, list[int]] | None:
    kwargs = dict(template_kwargs or {})
    if example.get("tools"):
        kwargs["tools"] = example["tools"]
    text = tokenizer.apply_chat_template(example["messages"], tokenize=False, **kwargs)
    spans = assistant_spans(text, assistant_start, turn_end)
    enc = tokenizer(text, add_special_tokens=False, return_offsets_mapping=True)
    ids, offsets = enc["input_ids"], enc["offset_mapping"]
    labels = [IGNORE] * len(ids)
    k = 0
    for t, (s, _e) in enumerate(offsets):
        while k < len(spans) and s >= spans[k][1]:
            k += 1
        if k < len(spans) and spans[k][0] <= s < spans[k][1]:
            labels[t] = ids[t]
    if len(ids) > max_length:
        return None  # drop over-long examples rather than train on a cut-off plan
    if all(x == IGNORE for x in labels):
        return None
    return {"input_ids": ids, "attention_mask": [1] * len(ids), "labels": labels}


class PadCollator:
    """Right-pads input_ids/attention_mask/labels to the longest sequence in the batch."""

    def __init__(self, pad_token_id: int, multiple_of: int = 8):
        self.pad = pad_token_id
        self.multiple_of = multiple_of

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, Any]:
        import torch

        n = max(len(f["input_ids"]) for f in features)
        n = -(-n // self.multiple_of) * self.multiple_of
        batch = {"input_ids": [], "attention_mask": [], "labels": []}
        for f in features:
            gap = n - len(f["input_ids"])
            batch["input_ids"].append(f["input_ids"] + [self.pad] * gap)
            batch["attention_mask"].append(f["attention_mask"] + [0] * gap)
            batch["labels"].append(f["labels"] + [IGNORE] * gap)
        return {k: torch.tensor(v, dtype=torch.long) for k, v in batch.items()}
