"""Persona schema of the AT-Benefits gym (docs/research/lotse-rl.md §5.2)."""

from __future__ import annotations

import warnings
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# `register` is a §5.2 field name; pydantic warns because BaseModel once had such a method.
warnings.filterwarnings("ignore", message='Field name "register"')

Split = Literal["train", "val", "test", "heldout_family"]
SPLITS: tuple[Split, ...] = ("train", "val", "test", "heldout_family")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Residence(_Strict):
    state: str
    district: str | int | None = (
        None  # Vienna districts are numbers 1-23 (office rules compare numbers)
    )


class Insurance(_Strict):
    carrier: str | None  # None: not insured
    status: str
    pension_carrier: str | None = None


class Care(_Strict):
    pflegegeld_level: int | None = Field(default=None, ge=0, le=7)
    needs: list[str] = Field(default_factory=list)


class Child(_Strict):
    age: int = Field(ge=0, le=26)


class Member(_Strict):
    role: Literal["subject", "helper"]
    age: int = Field(ge=0, le=105)
    sex: Literal["f", "m", "d"]
    residence: Residence
    insurance: Insurance
    employment: str
    income_band: str
    care: Care
    children: list[Child] = Field(default_factory=list)
    documents_held: list[str] = Field(default_factory=list)
    language: str
    register: Literal["formal", "neutral", "colloquial", "dialect"]
    literacy: Literal["low", "medium", "high"]


class Noise(_Strict):
    partial_knowledge: float = Field(ge=0, le=1)
    contradiction: float = Field(ge=0, le=1)
    dialect: float = Field(ge=0, le=1)


class Gold(BaseModel):
    """Engine output of `POST /gold`; extra keys the engine returns are kept verbatim."""

    model_config = ConfigDict(extra="allow")

    benefits: list[str] = Field(default_factory=list)
    offices: dict[str, Any] = Field(default_factory=dict)
    documents: dict[str, list[Any]] = Field(default_factory=dict)
    min_questions: int = Field(default=0, ge=0)
    citations: list[Any] = Field(default_factory=list)


class Persona(_Strict):
    id: str
    split: Split
    household: list[Member] = Field(min_length=1)
    situation_text: str = Field(min_length=1)
    goal: str
    noise: Noise
    gold: Gold | None = None

    def card(self) -> dict:
        """The persona card a simulator may see: everything except text and gold."""
        return self.model_dump(exclude={"situation_text", "gold"})
