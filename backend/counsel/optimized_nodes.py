"""Latency-optimized loop built on top of upstream commit e065de5.

The baseline nodes remain in baseline_nodes.py. This module changes only the
slot loop: one current-slot analyzer and one dual-candidate response call run
in parallel, then deterministic switch logic selects the response.
"""

from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
import os

from . import prompts
from .baseline_nodes import (
    consolidate_slots_node,
    gate_check_node,
    insight_report_node,
    rapport_node,
    values_node,
)
from .llm import ModelProviderError, call_model_json
from .state import (
    EXPLICIT_UNKNOWN_VALUE,
    SLOT_FALLBACK_QUESTIONS,
    SLOT_KOREAN_LABELS,
    SLOT_ORDER,
    SLOT_QUESTION_TEMPLATES,
    SessionState,
)


_INCIDENTAL_SAVE_THRESHOLD = 0.65
_INCIDENTAL_CONFIDENCE_THRESHOLD = 0.90


def _analyzer_timeout_seconds() -> float:
    try:
        return max(0.05, float(os.getenv("TARGET_ANALYZER_TIMEOUT_SECONDS", "3.5")))
    except ValueError:
        return 3.5


def _response_timeout_seconds() -> float:
    try:
        return max(
            0.05,
            float(os.getenv("OPTIMIZED_RESPONSE_TIMEOUT_SECONDS", "4.0")),
        )
    except ValueError:
        return 4.0


def _analyzer_api_route() -> str:
    return os.getenv("OPTIMIZED_ANALYZER_API_ROUTE", "analyzer").strip()


def _analyzer_thinking() -> str:
    return (
        os.getenv("OPTIMIZED_ANALYZER_REASONING_EFFORT")
        or os.getenv("OPTIMIZED_ANALYZER_THINKING", "low")
    ).strip()


def _response_api_route() -> str:
    return os.getenv("OPTIMIZED_RESPONSE_API_ROUTE", "primary").strip()


def _response_thinking() -> str:
    return (
        os.getenv("OPTIMIZED_RESPONSE_THINKING_LEVEL")
        or os.getenv("OPTIMIZED_RESPONSE_THINKING", "minimal")
    ).strip()


def _already_covered_label(slots, switches) -> str:
    labels = [
        SLOT_KOREAN_LABELS[slot]
        for slot in SLOT_ORDER
        if slots[slot] and switches.get(slot) in {"on", "unknown"}
    ]
    return ", ".join(labels) if labels else "(없음)"


def _first_off_slot(switches: dict[str, str], *, exclude: str | None = None) -> str | None:
    return next(
        (
            slot
            for slot in SLOT_ORDER
            if slot != exclude and switches.get(slot, "off") == "off"
        ),
        None,
    )


def _analyze_current(
    *,
    target_slot: str,
    bot_question: str,
    user_utterance: str,
) -> dict:
    try:
        return call_model_json(
            "gemini",
            task="target_slot_analysis",
            system=prompts.TARGET_ANALYZER_SYSTEM,
            user=prompts.TARGET_ANALYZER_TASK.format(
                target_slot_key=target_slot,
                slot_goal=SLOT_QUESTION_TEMPLATES[target_slot],
                bot_question=bot_question,
                user_utterance=user_utterance,
                missing_aspect_categories=prompts.MISSING_ASPECT_CATEGORIES[target_slot],
                incidental_sufficiency_guide=prompts.INCIDENTAL_SUFFICIENCY_GUIDE,
            ),
            api_route=_analyzer_api_route(),
            reasoning_effort=_analyzer_thinking(),
            timeout_seconds=_analyzer_timeout_seconds(),
        )
    except ModelProviderError:
        # Current-slot sufficiency affects the question selected for this turn,
        # so a late result must not mutate state in the background.  A bounded,
        # conservative fallback asks once more and then follows the normal
        # unknown transition on the next unresolved answer.
        return {
            "target_slot": target_slot,
            "value": None,
            "decision": "uncertain",
            "missing_aspect": "analyzer_fallback",
            "confidence": 0.0,
            "incidental_updates": [],
            "fallback_used": True,
        }


def _apply_incidental_updates(
    *,
    analysis: dict,
    current_slot: str,
    slots: dict[str, list[str]],
    switches: dict[str, str],
) -> list[str]:
    completed: list[str] = []
    raw_updates = analysis.get("incidental_updates")
    if not isinstance(raw_updates, list):
        return completed

    seen_slots: set[str] = set()
    for raw in raw_updates[:2]:
        if not isinstance(raw, dict):
            continue
        slot = str(raw.get("slot") or "")
        value = str(raw.get("value") or "").strip()
        if (
            slot not in SLOT_ORDER
            or slot == current_slot
            or slot in seen_slots
            or not value
            or value == EXPLICIT_UNKNOWN_VALUE
        ):
            continue
        seen_slots.add(slot)
        try:
            confidence = float(raw.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0

        if confidence < _INCIDENTAL_SAVE_THRESHOLD:
            continue
        if value not in slots[slot]:
            slots[slot].append(value)

        is_sufficient = raw.get("sufficient") is True
        if is_sufficient and confidence >= _INCIDENTAL_CONFIDENCE_THRESHOLD:
            slots[slot] = [
                item for item in slots[slot] if item != EXPLICIT_UNKNOWN_VALUE
            ]
            switches[slot] = "on"
            completed.append(slot)
        # A partial incidental update is still useful report context, but it
        # must not reopen a slot the user explicitly chose to skip.

    return completed


def _generate_candidates(
    *,
    current_slot: str,
    next_slot: str,
    bot_question: str,
    user_utterance: str,
    already_asked: str,
) -> dict:
    try:
        return call_model_json(
            "gemini",
            task="response_candidates",
            system=prompts.RESPONSE_CANDIDATES_SYSTEM,
            user=prompts.RESPONSE_CANDIDATES_TASK.format(
                bot_question=bot_question,
                user_utterance=user_utterance,
                current_slot_goal=SLOT_QUESTION_TEMPLATES[current_slot],
                next_slot_goal=SLOT_QUESTION_TEMPLATES[next_slot],
                already_asked=already_asked,
            ),
            api_route=_response_api_route(),
            thinking_level=_response_thinking(),
            timeout_seconds=_response_timeout_seconds(),
        )
    except ModelProviderError:
        # A slow empathy call must not break the counseling turn. The switch
        # decision still comes from the bounded analyzer; only wording falls
        # back to stable, slot-specific questions.
        return {
            "reflection": "말씀해 주신 내용을 잘 들었어요.",
            "if_sufficient": SLOT_FALLBACK_QUESTIONS[next_slot],
            "if_insufficient": SLOT_FALLBACK_QUESTIONS[current_slot],
            "fallback_used": True,
        }


def _initial_question(slot: str, reflection: str = "") -> dict:
    try:
        result = call_model_json(
            "gemini",
            task="next_question",
            system=prompts.QUESTION_PROMPT,
            user=prompts.NEXT_QUESTION_TASK.format(
                slot_goal=SLOT_QUESTION_TEMPLATES[slot],
                already_asked="(없음)",
            ),
            api_route=_response_api_route(),
            thinking_level=_response_thinking(),
            timeout_seconds=_response_timeout_seconds(),
        )
    except ModelProviderError:
        result = {"question": SLOT_FALLBACK_QUESTIONS[slot]}
    question = str(result.get("question") or SLOT_FALLBACK_QUESTIONS[slot]).strip()
    return {"message": f"{reflection} {question}".strip(), "question": question}


def optimized_render_question_node(state: SessionState) -> dict:
    slots = {slot: list(state["slots"][slot]) for slot in SLOT_ORDER}
    switches = dict(state.get("slot_switches") or {slot: "off" for slot in SLOT_ORDER})
    retry_count = dict(state.get("retry_count") or {slot: 0 for slot in SLOT_ORDER})
    asked_slots = list(state.get("asked_slots") or [])
    pending = state.get("pending")

    if not pending:
        target_slot = _first_off_slot(switches) or SLOT_ORDER[0]
        generated = _initial_question(target_slot, state.get("reflection_prefix") or "")
        switches[target_slot] = "asking"
        if target_slot not in asked_slots:
            asked_slots.append(target_slot)
        message = generated["message"]
        return {
            "bot_message": message,
            "pending": {
                "target_slot": target_slot,
                "question_intent": SLOT_QUESTION_TEMPLATES[target_slot],
            },
            "asked_slots": asked_slots,
            "slot_switches": switches,
            "reflection_prefix": None,
            "conversation_log": list(state["conversation_log"])
            + [{"role": "bot", "content": message}],
        }

    current_slot = pending["target_slot"]
    user_utterance = state.get("user_input") or ""
    next_slot = _first_off_slot(switches, exclude=current_slot) or current_slot
    covered = _already_covered_label(slots, switches)

    # copy_context keeps per-turn model metrics attached to both worker calls.
    with ThreadPoolExecutor(max_workers=2) as executor:
        analyze_future = executor.submit(
            copy_context().run,
            _analyze_current,
            target_slot=current_slot,
            bot_question=state.get("bot_message") or "",
            user_utterance=user_utterance,
        )
        response_future = executor.submit(
            copy_context().run,
            _generate_candidates,
            current_slot=current_slot,
            next_slot=next_slot,
            bot_question=state.get("bot_message") or "",
            user_utterance=user_utterance,
            already_asked=covered,
        )
        analysis = analyze_future.result()
        candidates = response_future.result()

    value = str(analysis.get("value") or "").strip()
    decision = str(analysis.get("decision") or "uncertain")
    try:
        confidence = float(analysis.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    valid_decisions = {
        "sufficient",
        "detail",
        "explicit_unknown",
        "off_target",
        "no_answer",
        "uncertain",
    }
    if decision not in valid_decisions:
        decision = "uncertain"
    if analysis.get("target_slot") != current_slot:
        value = ""
        decision = "no_answer"
        analysis["incidental_updates"] = []
    if decision in {"explicit_unknown", "off_target", "no_answer"}:
        value = ""
    if value == EXPLICIT_UNKNOWN_VALUE:
        value = ""
        decision = "no_answer"
    if decision == "sufficient" and not value:
        decision = "no_answer"
    if confidence < 0.55 and decision == "sufficient":
        decision = "uncertain"

    if value and value not in slots[current_slot]:
        slots[current_slot].append(value)

    incidental_slots = _apply_incidental_updates(
        analysis=analysis,
        current_slot=current_slot,
        slots=slots,
        switches=switches,
    )

    used_retry = retry_count.get(current_slot, 0) > 0
    needs_detail = decision in {"detail", "off_target", "no_answer", "uncertain"} and not used_retry

    if decision == "explicit_unknown":
        if EXPLICIT_UNKNOWN_VALUE not in slots[current_slot]:
            slots[current_slot].append(EXPLICIT_UNKNOWN_VALUE)
        switches[current_slot] = "unknown"
        target_slot = _first_off_slot(switches) or current_slot
        if target_slot != current_slot:
            switches[target_slot] = "asking"
            if target_slot not in asked_slots:
                asked_slots.append(target_slot)
        question = (
            str(candidates.get("if_sufficient") or "").strip()
            if target_slot == next_slot
            else SLOT_FALLBACK_QUESTIONS[target_slot]
        )
    elif needs_detail:
        retry_count[current_slot] = 1
        switches[current_slot] = "asking"
        target_slot = current_slot
        question = str(candidates.get("if_insufficient") or "").strip()
    else:
        if decision == "sufficient" and value:
            switches[current_slot] = "on"
        else:
            if EXPLICIT_UNKNOWN_VALUE not in slots[current_slot]:
                slots[current_slot].append(EXPLICIT_UNKNOWN_VALUE)
            switches[current_slot] = "unknown"

        target_slot = _first_off_slot(switches)
        if target_slot is None:
            # The gate closes after this node, so the values prompt replaces
            # this candidate in the same graph invocation.
            target_slot = current_slot
        else:
            switches[target_slot] = "asking"
            if target_slot not in asked_slots:
                asked_slots.append(target_slot)
        question = (
            str(candidates.get("if_sufficient") or "").strip()
            if target_slot == next_slot
            else SLOT_FALLBACK_QUESTIONS[target_slot]
        )

    reflection = str(candidates.get("reflection") or "").strip()
    fallback_question = SLOT_FALLBACK_QUESTIONS[target_slot]
    message = f"{reflection} {question or fallback_question}".strip()
    log = list(state["conversation_log"])
    if user_utterance:
        log.append({"role": "user", "content": user_utterance})
    log.append({"role": "bot", "content": message})

    return {
        "slots": slots,
        "bot_message": message,
        "pending": {
            "target_slot": target_slot,
            "question_intent": SLOT_QUESTION_TEMPLATES[target_slot],
        },
        "asked_slots": asked_slots,
        "reflection_prefix": None,
        "turn_count": state["turn_count"] + 1,
        "retry_count": retry_count,
        "slot_switches": switches,
        "last_analysis": {
            "target_slot": current_slot,
            "decision": decision,
            "missing_aspect": analysis.get("missing_aspect"),
            "confidence": confidence,
            "incidental_slots": incidental_slots,
            "fallback_used": bool(analysis.get("fallback_used")),
            "response_fallback_used": bool(candidates.get("fallback_used")),
        },
        "conversation_log": log,
    }
