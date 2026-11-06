"""Per-model OpenAI text-token prices in USD per 1M tokens.

Source: https://developers.openai.com/api/docs/pricing (redirect target of
https://platform.openai.com/docs/pricing), fetched 2026-11-06, Standard and Batch tiers, short
context (<= 272K input tokens).

The datagen backend is now a subscription-backed OpenAI-compatible proxy, so the budget is
counted in tokens (datagen.ledger); these list prices only yield an informational USD equivalent
(and enforce config `cap_usd` when it is set). `cost()` of an unpriced model is 0.0.
"""

from __future__ import annotations

from dataclasses import dataclass

SOURCE = "https://developers.openai.com/api/docs/pricing (fetched 2026-11-06)"


@dataclass(frozen=True)
class Price:
    input: float
    cached_input: float | None
    output: float
    batch_input: float
    batch_cached_input: float | None
    batch_output: float


# model: (input, cached, output, batch input, batch cached, batch output)
_TABLE: dict[str, tuple] = {
    "gpt-6-astra": (10.00, 1.00, 50.00, 5.00, 0.50, 25.00),
    "gpt-6.1-sol": (2.00, 0.10, 10.00, 1.00, 0.05, 5.00),
    "gpt-6.1-terra": (1.00, 0.05, 5.00, 0.50, 0.025, 2.50),
    "gpt-6-luna": (0.10, 0.01, 0.50, 0.05, 0.005, 0.25),
    "gpt-6-sol": (2.00, 0.20, 10.00, 1.00, 0.10, 5.00),
    "gpt-5.6-sol": (4.00, 0.40, 20.00, 2.00, 0.20, 10.00),
    "gpt-5.6-terra": (2.00, 0.20, 12.00, 1.00, 0.10, 6.00),
    "gpt-5.6-luna": (0.20, 0.02, 1.20, 0.10, 0.01, 0.60),
    "gpt-5.4": (2.50, 0.25, 15.00, 1.25, 0.13, 7.50),
    "gpt-5.4-mini": (0.75, 0.075, 4.50, 0.375, 0.0375, 2.25),
    "gpt-5.4-nano": (0.20, 0.02, 1.25, 0.10, 0.01, 0.625),
    "gpt-5-mini": (0.25, 0.025, 2.00, 0.125, 0.0125, 1.00),
    "gpt-5-nano": (0.05, 0.005, 0.40, 0.025, 0.0025, 0.20),
    "gpt-4.1-mini": (0.40, 0.10, 1.60, 0.20, None, 0.80),
    "gpt-4o-mini": (0.15, 0.075, 0.60, 0.075, None, 0.30),
}
PRICES: dict[str, Price] = {m: Price(*v) for m, v in _TABLE.items()}


class UnknownPrice(KeyError):
    pass


def price(model: str) -> Price:
    if model not in PRICES:
        raise UnknownPrice(
            f"no price for model {model!r}; add it to datagen/pricing.py from {SOURCE}"
        )
    return PRICES[model]


def known(model: str) -> bool:
    return model in PRICES


def cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cached_tokens: int = 0,
    *,
    batch: bool = False,
) -> float:
    """Actual cost from usage. Reasoning tokens are part of output_tokens (billed as output)."""
    if model not in PRICES:
        return 0.0
    p = PRICES[model]
    if batch:
        pin, pcached, pout = p.batch_input, p.batch_cached_input, p.batch_output
    else:
        pin, pcached, pout = p.input, p.cached_input, p.output
    if pcached is None:
        pcached = pin
    uncached = max(0, input_tokens - cached_tokens)
    return (uncached * pin + cached_tokens * pcached + output_tokens * pout) / 1e6


def worst_case(
    model: str, input_tokens: int, max_output_tokens: int, *, batch: bool = False
) -> float:
    return cost(model, input_tokens, max_output_tokens, 0, batch=batch)
