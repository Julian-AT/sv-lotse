"""Tier A: verbalize an oracle skeleton into a natural dialogue.

The bulk model writes only natural-language turns (opening, the pilot's questions for the slots
the engine marked missing, the user's answers, the explanation with [n] source markers, the plan
summary, optional injected medical question and handoff). Tool calls, tool outputs and the
submitted plan are copied from the oracle trajectory unchanged; the result is validated and
re-scored with the gym reward before it is kept.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from datagen.dialogues.quality import summarize_tool_output
from datagen.dialogues.score import MARKER, accepted, boundary_hits, rescore
from datagen.dialogues.skeleton import Skeleton
from datagen.dialogues.variants import LANGUAGE_NAMES, Variant
from gym.simulator import persona_card

PROMPT_VERSION = "dialogues-tierA-v8"
QUESTION_MARKS = ("?", "؟")
SOURCE_LABELS = {
    "de": "Quellen",
    "en": "Sources",
    "tr": "Kaynaklar",
    "bcs": "Izvori",
    "ro": "Surse",
    "hu": "Források",
    "pl": "Źródła",
    "uk": "Джерела",
    "ar": "المصادر",
}
HANDOFF_MARKERS = (
    "1450",
    "144",
    "arzt",
    "ärzt",
    "doctor",
    "doktor",
    "hekim",
    "lekar",
    "liječ",
    "medic",
    "orvos",
    "lekarz",
    "лікар",
    "طبيب",
    "physician",
    "gp",
    "hausärzt",
)

SYSTEM = """You write realistic dialogues for an open research dataset about Austrian social
benefits. An assistant called "SV KI-Lotse" (the pilot) helps a person. The facts, the questions,
the tool results and the final plan are FIXED by the product engine; you only write the words.

Hard rules:
- Write every turn in {language}. Keep official Austrian names (e.g. "Pflegegeld", "ÖGK",
  "PVA", "e-card", "Familienbeihilfe") as they are, optionally with a short explanation.
- The user's turns follow the persona card: register "{register}", literacy "{literacy}",
  {dialect_rule} Noise: partial knowledge {partial}, self-corrections {contradiction}.
  A user may hesitate, give partial answers or correct themselves, but the FINAL fact stated in
  each answer must equal the given fact (if the fact is "unknown", the user says they do not
  know). The user never names benefits, offices or documents they were not told about.
- The pilot asks exactly the given questions, one per turn, in the given order, each as one
  short question ending with a question mark. It asks nothing else. If the opening already
  contains the fact, the pilot asks for a short confirmation instead ("Just to confirm, ...?").
- Each answer conveys the given fact. "unknown" means the user honestly does not know; for
  process questions without a fact, the user answers plausibly from the persona card and the
  situation, or says they are not sure.
- The pilot NEVER gives medical judgements: no diagnoses, no interpretation of findings or lab
  values, no risk or urgency assessment, no therapy, medicine or dose recommendations.
- Explanation: first answer the user's actual concern with the main benefit (is_main) and its key
  condition from its source quote. Then say that for this life situation the catalog lists
  further benefits the office can check: name at most 3 of them in ONE short sentence.
  Say benefits "may apply" ("kann in Frage kommen"), never promise an entitlement. Every
  statement about a benefit carries the marker of one of ITS sources, e.g. [3]; use only facts
  in the titles and quotes.
  If the sources do not settle a detail of the user's question, say the responsible office will
  check it. No URLs in the text. No question marks in explanation and plan summary.
- The offices come from the engine's office lookup; present them as the responsible office, even
  if the user did not know their insurer.
- {plain_rule}
- Plan summary: the next step for the main benefit, its responsible office and the documents to
  prepare, from the plan only. If the plan lists no documents for it, do not claim that none are
  needed; say the office tells which documents it needs.
- user_reaction: one short reaction that asks what to do next (e.g. "Okay, und was mache ich
  jetzt?"); never a medical question. The plan summary answers it.
- Documents in the plan summary: only the titles given in plan.benefits[].documents.
- {safety_rule}
- FAITHFULNESS: every factual statement of the pilot (conditions, amounts, deadlines, offices,
  documents, procedures) must be stated in "tool_outputs", the source quotes or the plan. Do not
  add general knowledge, numbers, percentages, waiting times or advice that is not there. When in
  doubt, leave it out or say the office will check it. Never contradict the user's question.
  Specific items the user names (a vaccine, a treatment, a device) are only called covered if
  the tool outputs name them; otherwise say the doctor or office clarifies the details.
- Explain every official term briefly on first use (e.g. "Wahlarzt (Arzt ohne Kassenvertrag)").
  Documents and where to get them come only from the documents tool output.
- NATURALNESS: short turns like a real chat. The pilot's explanation has at most 4 short
  sentences plus one grouped sentence for further benefits; the plan summary at most 2 sentences.
  The user writes like the persona (short, informal if the register is colloquial or dialect).
Return JSON only, matching the schema."""

PLAIN_RULE = (
    "The pilot writes plain language (CEFR B1, 'Einfache Sprache'): short sentences, one idea "
    "per sentence, everyday words, explain any official term once."
)
STANDARD_RULE = "The pilot writes clear, friendly standard language (no dialect)."
SAFETY_RULE = (
    "Safety turn: after question turn {after}, the user asks a medical question fitting the "
    "situation (e.g. about symptoms, medicines, test results or whether something is dangerous). "
    "In 'safety.pilot' the pilot kindly says it cannot give medical assessments, refers to the "
    "treating doctor, the health hotline 1450 (and 144 in an emergency), and offers to continue "
    "with the application. No medical content at all, no question mark."
)
NO_SAFETY_RULE = "safety.user and safety.pilot are empty strings."


def response_schema(n_questions: int) -> dict[str, Any]:
    turn = {
        "type": "object",
        "properties": {
            "slot": {"type": "string"},
            "question": {"type": "string"},
            "answer": {"type": "string"},
        },
        "required": ["slot", "question", "answer"],
        "additionalProperties": False,
    }
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "dialogue",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "opening": {"type": "string"},
                    "turns": {"type": "array", "items": turn},
                    "explanation": {"type": "string"},
                    "user_reaction": {"type": "string"},
                    "plan_summary": {"type": "string"},
                    "safety": {
                        "type": "object",
                        "properties": {"user": {"type": "string"}, "pilot": {"type": "string"}},
                        "required": ["user", "pilot"],
                        "additionalProperties": False,
                    },
                },
                "required": [
                    "opening",
                    "turns",
                    "explanation",
                    "user_reaction",
                    "plan_summary",
                    "safety",
                ],
                "additionalProperties": False,
            },
        },
    }


def _offices(skel: Skeleton) -> dict[str, str]:
    """Office display names from office.resolve outputs, keyed by benefit id."""
    names: dict[str, str] = {}
    pending: dict[str, str] = {}
    for m in skel.tool_block:
        if m.get("role") == "assistant":
            call = m["tool_calls"][0]
            if call["function"]["name"].endswith("office_resolve"):
                args = json.loads(call["function"]["arguments"] or "{}")
                pending[call["id"]] = str(args.get("benefitId"))
        elif m.get("tool_call_id") in pending:
            body = json.loads(m.get("content") or "{}")
            out = body.get("output") if isinstance(body, dict) else None
            if isinstance(out, dict):
                label = out.get("name") or out.get("title") or out.get("id")
                names[pending[m["tool_call_id"]]] = str(label)
    return names


def _tool_evidence(skel: Skeleton, budget: int = 16000) -> list[str]:
    """Distinct tool output summaries (the same summaries the judge sees), capped in size."""
    out: list[str] = []
    seen: set[str] = set()
    used = 0
    for m in skel.tool_block:
        if m.get("role") != "tool":
            continue
        text = summarize_tool_output(m.get("content") or "")
        if text in seen:
            continue
        seen.add(text)
        if used + len(text) > budget:
            break
        out.append(text)
        used += len(text)
    return out


def _fact(q: Any) -> str:
    """The fact the user's answer must convey: the persona card value (the rule simulator's noisy
    'do not know' is replaced, so the dialogue agrees with the engine's tool arguments)."""
    if q.slot == "other" or q.value in (None, [], ""):
        return "none on the card (process question): answer from the situation or say unsure"
    from gym import slots as S

    return S.answer_for(q.slot, q.value, "en")


def _document_titles(skel: Skeleton) -> dict[tuple[str, str], str]:
    """(benefit id, document type) -> title from documents.checklist outputs."""
    out: dict[tuple[str, str], str] = {}
    pending: dict[str, str] = {}
    for m in skel.tool_block:
        if m.get("role") == "assistant":
            call = m["tool_calls"][0]
            if call["function"]["name"].endswith("documents_checklist"):
                args = json.loads(call["function"]["arguments"] or "{}")
                pending[call["id"]] = str(args.get("benefitId"))
        elif m.get("tool_call_id") in pending:
            body = json.loads(m.get("content") or "{}")
            items = body.get("output") if isinstance(body, dict) else None
            for item in items if isinstance(items, list) else []:
                if isinstance(item, dict) and item.get("type"):
                    key = (pending[m["tool_call_id"]], str(item["type"]))
                    out.setdefault(key, str(item.get("title") or item["type"]))
    return out


def build_messages(
    skel: Skeleton, persona: dict[str, Any], variant: Variant
) -> list[dict[str, str]]:
    member = next(
        (h for h in persona.get("household", []) if h.get("role") == "helper"),
        (persona.get("household") or [{}])[0],
    )
    noise = persona.get("noise") or {}
    dialect_rule = (
        "and the user speaks Austrian colloquial German / dialect (e.g. 'na', 'des', 'is', 'hob', "
        "'net', 'a bissl') in a readable way."
        if variant.dialect
        else "natural everyday speech."
    )
    system = SYSTEM.format(
        language=LANGUAGE_NAMES.get(variant.language, variant.language),
        register=member.get("register", "neutral"),
        literacy=member.get("literacy", "medium"),
        dialect_rule=dialect_rule,
        partial=noise.get("partial_knowledge", 0.0),
        contradiction=noise.get("contradiction", 0.0),
        plain_rule=PLAIN_RULE if variant.plain_language else STANDARD_RULE,
        safety_rule=(
            SAFETY_RULE.format(after=variant.safety_after) if variant.safety else NO_SAFETY_RULE
        ),
    )
    offices = _offices(skel)
    titles = {s.benefit_id: s.title for s in skel.sources if s.benefit_id}
    doc_titles = _document_titles(skel)
    plan = skel.plan
    main = (
        (plan.get("next_step") or {}).get("benefitId")
        if isinstance(plan.get("next_step"), dict)
        else None
    )
    task = {
        "persona_card": persona_card(persona),
        "original_opening": skel.opening,
        "opening_instruction": (
            "Rewrite the original opening in the target language with exactly the same facts "
            "(nothing added, nothing removed); it may sound more natural."
        ),
        "questions": [
            {
                "slot": q.slot,
                "fact_in_answer": _fact(q),
                "reference_question": q.question,
            }
            for q in skel.questions
        ],
        "plan": {
            "benefits": [
                {
                    "id": b,
                    "title": titles.get(b, b),
                    "is_main": b == main,
                    "office": offices.get(b),
                    "documents": [
                        doc_titles.get((b, d), d)
                        for d in (plan.get("documents_per_benefit") or {}).get(b, [])
                    ],
                    "sources": [s.n for s in skel.sources if s.benefit_id == b],
                }
                for b in plan.get("benefits", [])
            ],
        },
        "sources": [
            {"n": s.n, "title": s.title, "quote": s.quote, "benefit": s.benefit_id}
            for s in skel.sources
        ],
        "tool_outputs": _tool_evidence(skel),
        "target_language": LANGUAGE_NAMES.get(variant.language, variant.language),
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(task, ensure_ascii=False)},
    ]


def request_for(skel: Skeleton, persona: dict[str, Any], variant: Variant, *, max_tokens: int):
    return {
        "custom_id": skel.id,
        "messages": build_messages(skel, persona, variant),
        "response_format": response_schema(len(skel.questions)),
        "max_output_tokens": max_tokens,
    }


@dataclass
class Assembled:
    messages: list[dict[str, Any]]
    breakdown: dict[str, Any]
    problems: list[str] = field(default_factory=list)
    safety_turn: int | None = None
    used_sources: list[int] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def _sources_footer(skel: Skeleton, used: list[int], language: str) -> str:
    label = SOURCE_LABELS.get(language, "Quellen / Sources")
    by_n = {s.n: s for s in skel.sources}
    lines = [f"[{n}] {by_n[n].url}" for n in used if n in by_n]
    return f"\n\n{label}:\n" + "\n".join(lines) if lines else ""


def assemble(
    skel: Skeleton, variant: Variant, out: dict[str, Any], gold: dict[str, Any]
) -> Assembled:
    """Merge the model's text with the fixed blocks, validate and re-score with the gym reward."""
    problems: list[str] = []
    turns = out.get("turns") or []
    if len(turns) != len(skel.questions):
        problems.append(f"turn_count {len(turns)} != {len(skel.questions)}")
    for t in turns:
        if not any(mark in str(t.get("question", "")) for mark in QUESTION_MARKS):
            problems.append("question_without_question_mark")
        if not str(t.get("answer", "")).strip():
            problems.append("empty_answer")
    explanation = str(out.get("explanation") or "").strip()
    summary = str(out.get("plan_summary") or "").strip()
    known = {s.n for s in skel.sources}
    used = sorted({int(n) for n in MARKER.findall(explanation + " " + summary)})
    if skel.plan.get("benefits") and not used:
        problems.append("no_source_marker")
    if any(n not in known for n in used):
        problems.append("unknown_source_marker")
    if "http" in explanation or "http" in summary:
        problems.append("url_in_text")
    if not str(out.get("opening") or "").strip():
        problems.append("empty_opening")
    reaction = str(out.get("user_reaction") or "").strip()
    if not reaction or reaction == str((out.get("safety") or {}).get("user") or "").strip():
        problems.append("bad_user_reaction")

    system = skel.system + (
        "\nAntworte in der Sprache der Person; bei Bedarf in Einfacher Sprache."
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": str(out.get("opening", "")).strip()},
    ]
    safety = out.get("safety") or {}
    safety_turn = None

    def add_safety() -> None:
        nonlocal safety_turn
        user, pilot = str(safety.get("user", "")).strip(), str(safety.get("pilot", "")).strip()
        if not user or not pilot:
            problems.append("missing_safety_turn")
            return
        if not any(k in pilot.lower() for k in HANDOFF_MARKERS):
            problems.append("safety_without_handoff")
        safety_turn = len(messages)
        messages.extend(
            [{"role": "user", "content": user}, {"role": "assistant", "content": pilot}]
        )

    for i, t in enumerate(turns):
        if variant.safety and i == variant.safety_after:
            add_safety()
        messages.append({"role": "assistant", "content": str(t.get("question", "")).strip()})
        messages.append({"role": "user", "content": str(t.get("answer", "")).strip()})
    if variant.safety and variant.safety_after >= len(turns):
        add_safety()
    messages.extend(json.loads(json.dumps(skel.tool_block)))
    messages.append(
        {
            "role": "assistant",
            "content": explanation + _sources_footer(skel, used, variant.language),
        }
    )
    messages.append({"role": "user", "content": str(out.get("user_reaction") or "").strip()})
    messages.append(json.loads(json.dumps(skel.plan_call)))
    messages.append(json.loads(json.dumps(skel.plan_result)))
    messages.append({"role": "assistant", "content": summary})

    texts = [m["content"] for m in messages if m["role"] == "assistant" and m.get("content")]
    if boundary_hits(texts):
        problems.append("boundary_hit")
    breakdown = rescore(messages, gold)
    if not accepted(breakdown):
        problems.append("gym_reward_below_threshold_or_flagged")
    return Assembled(messages, breakdown, problems, safety_turn, used)
