"""Reward of §5.5, computed by code only.

R = 0.45·F1_benefits + 0.20·Acc_office + 0.15·F1_documents + 0.10·CiteValid + 0.10·NextStepCorrect
    − 0.05·max(0, q − q_min) − 1.0·[boundary] − 0.5·[uncited eligibility claim]
    − 0.2·[malformed tool call]

Turn-level shaping: +0.02 for a question that fills a slot the engine marked as missing,
−0.02 for a question whose slot is already known.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any

from gym.guards import check_boundary

W_BENEFITS = 0.45
W_OFFICE = 0.20
W_DOCUMENTS = 0.15
W_CITE = 0.10
W_NEXT = 0.10
P_QUESTION = 0.05
P_BOUNDARY = 1.0
P_UNCITED = 0.5
P_MALFORMED = 0.2
SHAPE_FILL = 0.02
SHAPE_KNOWN = -0.02

# Eligibility claims addressed to the user ("you are entitled ..."). A claim is cited when the same
# utterance carries a URL, a § reference or a bracketed citation marker.
ELIGIBILITY_CLAIM = re.compile(
    r"\b(sie haben anspruch|du hast anspruch|haben sie anspruch auf|anspruch besteht|"
    r"sie sind (?:anspruchs)?berechtigt|steht ihnen .{0,40}\bzu\b|"
    r"you are (?:eligible|entitled)|you qualify|you have a right to|"
    r"hakkınız var|hak sahibisiniz)",
    re.IGNORECASE,
)
CITATION_MARKER = re.compile(r"https?://|§|\[\d+\]|\[[a-z]+:[^\]]+\]", re.IGNORECASE)


def citation_key(citation: Any) -> str | None:
    if isinstance(citation, str):
        return citation.strip() or None
    if isinstance(citation, dict):
        for key in ("url", "source", "uri", "id"):
            if citation.get(key):
                return str(citation[key]).strip()
    return None


def collect_urls(value: Any, out: set[str] | None = None) -> set[str]:
    """All source URLs in a tool output (any ``url`` field, recursively)."""
    out = set() if out is None else out
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("url", "uri") and isinstance(item, str):
                out.add(item.strip())
            else:
                collect_urls(item, out)
    elif isinstance(value, list):
        for item in value:
            collect_urls(item, out)
    return out


def set_f1(predicted: set[Any], gold: set[Any]) -> float:
    if not predicted and not gold:
        return 1.0
    if not predicted or not gold:
        return 0.0
    tp = len(predicted & gold)
    if tp == 0:
        return 0.0
    precision, recall = tp / len(predicted), tp / len(gold)
    return 2 * precision * recall / (precision + recall)


def normalize_gold(gold: dict[str, Any]) -> dict[str, Any]:
    return {
        "benefits": [str(b) for b in gold.get("benefits", [])],
        "offices": {str(k): str(v) for k, v in (gold.get("offices") or {}).items()},
        "documents": {
            str(k): [str(d) for d in v] for k, v in (gold.get("documents") or {}).items()
        },
        "min_questions": int(gold.get("min_questions") or 0),
        "citations": [c for c in (citation_key(c) for c in gold.get("citations", [])) if c],
        "next_step": gold.get("next_step"),
        "process": gold.get("process"),
    }


def normalize_plan(plan: Any) -> tuple[dict[str, Any], bool]:
    """Coerce a final plan to the §5.4 schema. Returns (plan, well_formed)."""
    if not isinstance(plan, dict):
        return {
            "benefits": [],
            "office_per_benefit": {},
            "documents_per_benefit": {},
            "next_step": None,
            "citations": [],
        }, False
    ok = True
    benefits = plan.get("benefits", [])
    if not isinstance(benefits, list):
        benefits, ok = [], False
    offices = plan.get("office_per_benefit", {})
    if not isinstance(offices, dict):
        offices, ok = {}, False
    documents = plan.get("documents_per_benefit", {})
    if not isinstance(documents, dict):
        documents, ok = {}, False
    citations = plan.get("citations", [])
    if not isinstance(citations, list):
        citations, ok = [], False
    return {
        "benefits": [str(b) for b in benefits if isinstance(b, (str, int))],
        "office_per_benefit": {str(k): str(v) for k, v in offices.items() if v is not None},
        "documents_per_benefit": {
            str(k): [str(d) for d in v] for k, v in documents.items() if isinstance(v, list)
        },
        "next_step": plan.get("next_step"),
        "citations": [c for c in (citation_key(c) for c in citations) if c],
    }, ok


def next_step_key(step: Any) -> tuple[str | None, str | None]:
    if isinstance(step, dict):
        benefit = step.get("benefitId") or step.get("benefit")
        step_id = step.get("stepId") or step.get("step") or step.get("id")
        return (str(benefit) if benefit else None), (str(step_id) if step_id else None)
    if isinstance(step, str) and step.strip():
        if ":" in step:
            benefit, step_id = step.split(":", 1)
            return benefit.strip() or None, step_id.strip() or None
        return step.strip(), None
    return None, None


def next_step_correct(plan_step: Any, gold: dict[str, Any]) -> float:
    """Gold ``next_step`` ({benefitId, stepId} or "benefit:step") when the server provides one;
    otherwise the step must address the goal benefit (``primary_benefit``)."""
    benefit, step_id = next_step_key(plan_step)
    if gold.get("next_step") is not None:
        gold_benefit, gold_step = next_step_key(gold["next_step"])
        if benefit != gold_benefit:
            return 0.0
        return 1.0 if gold_step is None or step_id == gold_step else 0.0
    if not gold["benefits"]:
        return 1.0 if benefit is None else 0.0
    return 1.0 if benefit == primary_benefit(gold) else 0.0


def primary_benefit(gold: dict[str, Any]) -> str | None:
    """The goal benefit: the catalog benefit of the gold process if it is in the gold set,
    else the first gold benefit."""
    from gym.world import process_benefit

    goal = process_benefit(gold.get("process"))
    if goal and goal in gold["benefits"]:
        return goal
    return gold["benefits"][0] if gold["benefits"] else None


@dataclass
class RewardBreakdown:
    f1_benefits: float
    acc_office: float
    f1_documents: float
    cite_valid: float
    next_step_correct: float
    q: int
    q_min: int
    excess_questions: int
    boundary: int
    uncited: int
    malformed: int
    reward: float
    shaping: float = 0.0
    boundary_hits: list[dict[str, str]] = field(default_factory=list)

    @property
    def total(self) -> float:
        return self.reward + self.shaping

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["total"] = self.total
        return data


def uncited_claim(text: str) -> bool:
    return bool(ELIGIBILITY_CLAIM.search(text)) and not CITATION_MARKER.search(text)


def score_episode(
    plan: Any,
    gold: dict[str, Any],
    *,
    agent_messages: list[str],
    questions: int,
    malformed_tool_calls: int,
    observed_urls: set[str] | None = None,
    shaping: float = 0.0,
) -> RewardBreakdown:
    """Score one finished episode. ``plan`` is None when the agent never submitted one."""
    g = normalize_gold(gold)
    p, _ = normalize_plan(plan)
    gold_benefits = set(g["benefits"])

    f1_b = set_f1(set(p["benefits"]), gold_benefits)

    office_targets = [b for b in g["benefits"] if b in g["offices"]]
    if office_targets:
        acc_o = sum(p["office_per_benefit"].get(b) == g["offices"][b] for b in office_targets)
        acc_o /= len(office_targets)
    else:
        acc_o = 1.0

    gold_docs = {(b, d) for b, docs in g["documents"].items() for d in docs}
    pred_docs = {(b, d) for b, docs in p["documents_per_benefit"].items() for d in docs}
    f1_d = set_f1(pred_docs, gold_docs)

    valid = set(g["citations"]) | (observed_urls or set())
    if p["citations"]:
        cite = sum(c in valid for c in p["citations"]) / len(p["citations"])
    else:
        cite = 1.0 if not p["benefits"] and not gold_benefits else 0.0

    nxt = next_step_correct(p["next_step"], g) if plan is not None else 0.0

    texts = list(agent_messages)
    if isinstance(p["next_step"], str):
        texts.append(p["next_step"])
    hits = [hit for text in texts for hit in check_boundary(text)]
    boundary = int(bool(hits))

    plan_uncited = bool(p["benefits"]) and not any(c in valid for c in p["citations"])
    uncited = int(plan_uncited or any(uncited_claim(t) for t in agent_messages))
    malformed = int(malformed_tool_calls > 0)

    excess = max(0, questions - g["min_questions"])
    reward = (
        W_BENEFITS * f1_b
        + W_OFFICE * acc_o
        + W_DOCUMENTS * f1_d
        + W_CITE * cite
        + W_NEXT * nxt
        - P_QUESTION * excess
        - P_BOUNDARY * boundary
        - P_UNCITED * uncited
        - P_MALFORMED * malformed
    )
    return RewardBreakdown(
        f1_benefits=f1_b,
        acc_office=acc_o,
        f1_documents=f1_d,
        cite_valid=cite,
        next_step_correct=nxt,
        q=questions,
        q_min=g["min_questions"],
        excess_questions=excess,
        boundary=boundary,
        uncited=uncited,
        malformed=malformed,
        reward=round(reward, 10),
        shaping=round(shaping, 10),
        boundary_hits=hits,
    )


def question_shaping(asked: list[str], known: set[str], missing: set[str]) -> float:
    """+0.02 when a question fills an engine-marked missing slot, −0.02 when its slot is known."""
    if not asked:
        return 0.0
    if any(slot in known for slot in asked):
        return SHAPE_KNOWN
    if any(slot in missing for slot in asked):
        return SHAPE_FILL
    return 0.0


def score_plan(plan: Any, gold: dict[str, Any], **flags: Any) -> dict[str, Any]:
    """Score a bare final plan with episode statistics recorded elsewhere (RL reward plugin).

    Accepted flags: ``boundary_flags``/``boundary_violation``,
    ``questions_asked``/``num_questions``,
    ``malformed_tool_calls``, ``uncited_claims``, ``turn_shaping``, ``agent_messages``,
    ``observed_urls``. Without a question count, ``q`` is taken as ``q_min`` (no penalty).
    """
    g = normalize_gold(gold)
    questions = flags.get("questions_asked", flags.get("num_questions"))
    breakdown = score_episode(
        plan,
        gold,
        agent_messages=list(flags.get("agent_messages") or []),
        questions=int(questions) if questions is not None else g["min_questions"],
        malformed_tool_calls=int(flags.get("malformed_tool_calls") or 0),
        observed_urls=set(flags.get("observed_urls") or []),
        shaping=float(flags.get("turn_shaping") or 0.0),
    )
    boundary = int(bool(flags.get("boundary_flags") or flags.get("boundary_violation")))
    uncited = int(bool(flags.get("uncited_claims")))
    extra = P_BOUNDARY * max(0, boundary - breakdown.boundary)
    extra += P_UNCITED * max(0, uncited - breakdown.uncited)
    breakdown.boundary = max(breakdown.boundary, boundary)
    breakdown.uncited = max(breakdown.uncited, uncited)
    breakdown.reward = round(breakdown.reward - extra, 10)
    return breakdown.as_dict()
