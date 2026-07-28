import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from contextvars import copy_context

from .data import VALUE_IDS, get_value, value_list_text
from .debug import debug_print
from .delivery import (
    baseline_waiting_bridge_active,
    mark_baseline_continuation_ready,
    publish_baseline_aside,
    publish_baseline_reflection,
)
from .gate import compute_gate
from .state import (
    SessionState,
    SLOT_ORDER,
    SLOT_QUESTION_TEMPLATES,
    SLOT_KOREAN_LABELS,
    SLOT_FALLBACK_QUESTIONS,
    SLOT_DETAIL_QUESTIONS,
    EXPLICIT_UNKNOWN_VALUE,
)
from .llm import ModelProviderError, analyzer_api_is_separate, call_model_json
from .principle_retrieval import PrincipleCandidate, RetrievalContext
from .principle_runtime import (
    PRINCIPLE_SNAPSHOT,
    retrieve_principle_candidates,
)
from . import prompts


BASELINE_TASKS = {
    "REFLECT": "reflect",
    "TURN_ANALYSIS": "baseline_turn_analysis",
    "OPENING": "baseline_opening",
    "CONSOLIDATE": "consolidate_slots",
    "INSIGHT_REPORT": "insight_report",
}

def _timed_llm_call(label: str, system: str, user: str, **kwargs) -> dict:
    start = time.perf_counter()
    result = call_model_json(
        "gemini",
        task=BASELINE_TASKS[label],
        system=system,
        user=user,
        reasoning_effort=kwargs.get("reasoning_effort"),
        api_route=kwargs.get("api_route", "primary"),
        thinking_level=kwargs.get("thinking_level"),
        timeout_seconds=kwargs.get("timeout_seconds"),
    )
    elapsed = time.perf_counter() - start
    debug_print(f"[TIMING DEBUG] llm call '{label}': {elapsed:.3f}s")
    return result


def _log(state: SessionState, role: str, content: str) -> list[dict]:
    log = list(state["conversation_log"])
    log.append({"role": role, "content": content})
    return log


def _reflect(
    bot_question: str,
    user_utterance: str,
    *,
    api_route: str = "primary",
    thinking_level: str | None = None,
    timeout_seconds: float | None = None,
) -> str:
    result = _timed_llm_call(
        "REFLECT",
        prompts.RESPONSE_SYSTEM,
        prompts.REFLECT_TASK.format(bot_question=bot_question, user_utterance=user_utterance),
        api_route=api_route,
        thinking_level=thinking_level,
        timeout_seconds=timeout_seconds,
    )
    return str(result.get("reflection", "")).strip()


def _bounded_seconds(env_name: str, default: float) -> float:
    try:
        return max(0.05, float(os.getenv(env_name, str(default))))
    except ValueError:
        return default


def _baseline_response_thinking() -> str:
    return (
        os.getenv("BASELINE_RESPONSE_THINKING_LEVEL")
        or os.getenv("BASELINE_RESPONSE_THINKING", "minimal")
    ).strip()


def _baseline_analyzer_thinking() -> str:
    return (
        os.getenv("BASELINE_ANALYZER_REASONING_EFFORT")
        or os.getenv("BASELINE_ANALYZER_THINKING", "low")
    ).strip()


def _baseline_response_timeout_seconds() -> float:
    # This is a failure ceiling, not an intentional wait. The response is
    # published as soon as it finishes; a realistic ceiling avoids converting
    # normal Vertex tail latency into a canned fallback.
    return _bounded_seconds("BASELINE_RESPONSE_TIMEOUT_SECONDS", 4.0)


def _baseline_analyzer_timeout_seconds() -> float:
    return _bounded_seconds("BASELINE_ANALYZER_TIMEOUT_SECONDS", 4.0)


def _baseline_opening_lead_timeout_seconds() -> float:
    # If Vertex has a long-tail stall, do not make the streamed/TTS path remain
    # silent until the provider-level timeout. The model call still finishes in
    # its worker and the analyzer remains authoritative for routing.
    return _bounded_seconds("BASELINE_OPENING_LEAD_TIMEOUT_SECONDS", 1.8)


def _local_baseline_analysis(
    *,
    target_slot: str,
    user_utterance: str,
) -> dict | None:
    """Resolve only unambiguous cases without spending an analyzer call."""

    normalized = " ".join(
        re.sub(r"[^0-9A-Za-z가-힣\s]", " ", str(user_utterance or "").lower()).split()
    )
    if not normalized:
        return None

    if len(normalized) <= 45 and re.search(
        r"(?:잘\s*)?(?:모르겠(?:어|어요|습니다)?|"
        r"기억(?:이\s*)?안\s*나(?:요)?|생각(?:이\s*)?안\s*나(?:요)?)$",
        normalized,
    ):
        return {
            "target_slot": target_slot,
            "value": None,
            "decision": "explicit_unknown",
            "incidental_updates": [],
            "analysis_source": "local_rule",
        }

    if target_slot == "duration":
        has_period = bool(
            re.search(
                r"(?:\d+|한|두|세|네|몇)\s*"
                r"(?:일|주|주일|달|개월|년)",
                normalized,
            )
        )
        has_frequency = bool(
            re.search(
                r"(?:거의\s*)?매번|자주|가끔|때마다|매일|매주|매달|"
                r"일주일에|한\s*달에|\d+\s*번",
                normalized,
            )
        )
        if has_period and has_frequency:
            return {
                "target_slot": target_slot,
                "value": str(user_utterance).strip(),
                "decision": "sufficient",
                "incidental_updates": [],
                "analysis_source": "local_rule",
            }

    if not 5 <= len(normalized) <= 120:
        return None

    simple_slot_patterns = {
        "emotion": (
            r"화(?:가|도)?\s*나|답답|불안|슬프|속상|기쁘|두렵|무섭|"
            r"지치|허탈|초조|억울|외롭|괴롭|막막"
        ),
        "thought": (
            r"생각(?:이|을|도)?|것\s*같|라고\s*(?:느끼|생각)|"
            r"라는\s*생각|못\s*(?:할|낼|해낼)|해야\s*(?:할|한다)"
        ),
        "goal": r"고\s*싶|되고\s*싶|바라|달라지고|해내고\s*싶",
        "self_message": (
            r"말해\s*주고\s*싶|말하고\s*싶|라고\s*해\s*주고|"
            r"괜찮다고|잘했다고|해도\s*된다고"
        ),
    }
    pattern = simple_slot_patterns.get(target_slot)
    if pattern and re.search(pattern, normalized):
        return {
            "target_slot": target_slot,
            "value": str(user_utterance).strip(),
            "decision": "sufficient",
            "incidental_updates": [],
            "analysis_source": "local_rule",
        }

    if target_slot == "relationship":
        has_person = bool(
            re.search(
                r"사람|친구|가족|부모|동료|팀원|연인|배우자|주변",
                normalized,
            )
        )
        has_change = bool(
            re.search(
                r"피하|멀어|연락|말을\s*안|꺼내기|다투|관계|"
                r"부담|고립|영향\s*없|달라",
                normalized,
            )
        )
        if has_person and has_change:
            return {
                "target_slot": target_slot,
                "value": str(user_utterance).strip(),
                "decision": "sufficient",
                "incidental_updates": [],
                "analysis_source": "local_rule",
            }

    if target_slot == "coping":
        has_method = bool(
            re.search(
                r"알람|캘린더|스터디|계획|메모|도움\s*요청|"
                r"상담|운동|쉬어|나눠|시도|해\s*봤",
                normalized,
            )
        )
        has_result = bool(
            re.search(
                r"도움(?:이|은)?\s*(?:됐|안|되지)|소용없|효과|"
                r"나아지|부담|유지|아쉬",
                normalized,
            )
        )
        if has_method and has_result:
            return {
                "target_slot": target_slot,
                "value": str(user_utterance).strip(),
                "decision": "sufficient",
                "incidental_updates": [],
                "analysis_source": "local_rule",
            }

    return None


def _analyze_baseline_turn(
    *,
    target_slot: str,
    bot_question: str,
    user_utterance: str,
    api_route: str = "primary",
) -> dict:
    try:
        return _timed_llm_call(
            "TURN_ANALYSIS",
            prompts.BASELINE_TURN_ANALYZER_SYSTEM,
            prompts.BASELINE_TURN_ANALYZER_TASK.format(
                target_slot_key=target_slot,
                slot_criterion=prompts.BASELINE_SLOT_CRITERIA[target_slot],
                bot_question=bot_question,
                user_utterance=user_utterance,
                incidental_guide=prompts.BASELINE_INCIDENTAL_GUIDE,
            ),
            reasoning_effort=_baseline_analyzer_thinking(),
            api_route=api_route,
            timeout_seconds=_baseline_analyzer_timeout_seconds(),
        )
    except ModelProviderError:
        return {
            "target_slot": target_slot,
            "value": None,
            "decision": "uncertain",
            "incidental_updates": [],
            "fallback_used": True,
        }


def _generate_baseline_opening(
    *,
    bot_question: str,
    user_utterance: str,
) -> dict:
    try:
        return _timed_llm_call(
            "OPENING",
            prompts.BASELINE_OPENING_SYSTEM,
            prompts.BASELINE_OPENING_TASK.format(
                bot_question=bot_question,
                user_utterance=user_utterance,
            ),
            thinking_level=_baseline_response_thinking(),
            timeout_seconds=_baseline_response_timeout_seconds(),
        )
    except ModelProviderError:
        return {
            "empathy": "말씀해 주신 마음을 잘 들었어요.",
            "fallback_used": True,
        }


def _resolve_baseline_opening(
    response_future,
    *,
    target_slot: str,
    principle_aside: str = "",
) -> tuple[dict, str, str, str]:
    """Resolve opening while bounding silence on the segmented delivery path."""
    early_reflection = ""
    delivered_principle_aside = ""

    def publish_opening(reflection: str) -> None:
        nonlocal delivered_principle_aside
        publish_baseline_reflection(reflection)
        if principle_aside and _safe_principle_line(principle_aside, reflection):
            publish_baseline_aside(principle_aside)
            if not baseline_waiting_bridge_active():
                delivered_principle_aside = principle_aside

    try:
        opening = response_future.result(
            timeout=_baseline_opening_lead_timeout_seconds()
        )
    except FutureTimeoutError:
        opening = None
        early_reflection = prompts.BASELINE_LEAD_EMPATHY[target_slot]
        publish_opening(early_reflection)

    if opening is None:
        opening = response_future.result()
        model_reflection = str(opening.get("empathy") or "").strip()
        # A stream already heard the bounded lead fallback, so it remains
        # canonical. Non-stream callers still receive the richer model text.
        reflection = early_reflection or model_reflection
        if not early_reflection:
            publish_opening(reflection)
    else:
        reflection = str(opening.get("empathy") or "").strip()
        if not reflection:
            reflection = prompts.BASELINE_LEAD_EMPATHY[target_slot]
        publish_opening(reflection)

    return opening, reflection, early_reflection, delivered_principle_aside


def _aside_cooldown_turns() -> int:
    try:
        return max(1, int(os.getenv("BASELINE_ASIDE_COOLDOWN_TURNS", "3")))
    except ValueError:
        return 3


def _env_enabled(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _principle_feature_mode() -> str:
    mode = os.getenv("BASELINE_PRINCIPLE_MODE", "on").strip().lower()
    return mode if mode in {"off", "shadow", "on"} else "on"


def _reference_enabled() -> bool:
    return _env_enabled("BASELINE_PRINCIPLE_REFERENCE_ENABLED", False)


_PRINCIPLE_BLOCKED_TERMS = {
    "self_harm_or_suicide": ("자살", "자해", "죽고 싶", "목숨을 끊"),
    "acute_crisis": ("당장 위험", "살려 주세요", "지금 죽", "통제할 수 없"),
    "abuse_or_violence": ("가정폭력", "학대", "폭행", "맞았어요", "때렸어요", "협박"),
    "sexual_harm": ("성폭행", "성추행", "강간", "성적 학대"),
    "acute_trauma": ("큰 사고를 당", "사고가 방금", "참사를 겪"),
    "bereavement": ("사별", "장례", "돌아가셨어", "세상을 떠났"),
    "medical_emergency": ("응급실", "심한 출혈", "숨을 못 쉬", "의식을 잃"),
    "legal_emergency": ("긴급 체포", "구속됐", "법적 긴급"),
}


def _blocked_term_matches(compact: str, term: str) -> bool:
    if term == "사별":
        # `회사별`, `부서별`처럼 다른 단어 안에 우연히 포함된 "사별"은
        # bereavement로 보지 않는다. 실제 명사/활용형(사별 후, 사별했어요 등)만
        # 원리 설명을 차단한다.
        return bool(
            re.search(
                r"(?<![0-9a-z가-힣])사별(?:$|[\s,.;:!?]|을|이|가|과|로|후|했|한)",
                compact,
            )
        )
    return term in compact


def _blocked_principle_contexts(user_utterance: str) -> frozenset[str]:
    compact = " ".join(str(user_utterance or "").lower().split())
    return frozenset(
        context
        for context, terms in _PRINCIPLE_BLOCKED_TERMS.items()
        if any(_blocked_term_matches(compact, term) for term in terms)
    )


def _recent_user_texts(state: SessionState) -> tuple[str, ...]:
    return tuple(
        str(item.get("content") or "")
        for item in state.get("conversation_log") or []
        if item.get("role") == "user" and str(item.get("content") or "").strip()
    )[-2:]


def _retrieve_candidates(
    *,
    state: SessionState,
    current_slot: str,
    user_utterance: str,
    aside_allowed: bool,
) -> tuple[tuple[PrincipleCandidate, ...], float, str]:
    started = time.perf_counter()
    if _principle_feature_mode() == "off":
        return (), 0.0, "feature_off"
    if not aside_allowed:
        return (), 0.0, "cooldown"

    blocked_contexts = _blocked_principle_contexts(user_utterance)
    if blocked_contexts:
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        return (), elapsed_ms, "blocked_context"

    try:
        context = RetrievalContext(
            user_text=user_utterance,
            current_slot=current_slot,
            recent_user_texts=_recent_user_texts(state),
            slot_values={
                slot: tuple(state["slots"].get(slot, [])[-2:])
                for slot in ("emotion", "thought", "behavior", "coping", "goal")
            },
            blocked_contexts=blocked_contexts,
            recent_principle_ids=tuple(
                state.get("recent_principle_ids") or []
            )[-3:],
            allow_reference=_reference_enabled(),
        )
        candidates = retrieve_principle_candidates(context, limit=3)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        return (
            candidates,
            elapsed_ms,
            "candidate_ready" if candidates else "no_match",
        )
    except Exception as exc:
        debug_print(
            "[PRINCIPLE DEBUG] local retrieval failed: "
            f"{type(exc).__name__}: {exc}"
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
        return (), elapsed_ms, "retrieval_error"


def _principle_line(
    candidate: PrincipleCandidate,
    mode: str,
) -> str:
    principle = candidate.principle
    if mode == "named_pattern":
        return str(principle["named_pattern"]["utterance"]).strip()
    if mode == "social_context":
        return str(principle["social_context"]["utterance"]).strip()
    if mode == "reference" and _reference_enabled():
        references = [
            reference
            for reference in principle["references"]
            if reference["policy"] == "direct"
        ]
        if references:
            text = str(references[0]["text"]).strip()
            text = re.sub(r"\s+[一-鿿]{4}$", "", text)
            return f"‘{text}’라는 말도 있지요."
    return ""


def _similar_to_reflection(line: str, reflection: str) -> bool:
    def tokens(text: str) -> set[str]:
        return set(re.findall(r"[가-힣A-Za-z0-9]{2,}", text.lower()))

    line_tokens = tokens(line)
    reflection_tokens = tokens(reflection)
    if len(line_tokens) < 3 or len(reflection_tokens) < 3:
        return False
    overlap = len(line_tokens & reflection_tokens)
    return overlap / min(len(line_tokens), len(reflection_tokens)) >= 0.7


def _safe_principle_line(line: str, reflection: str) -> bool:
    normalized = " ".join(str(line or "").split()).strip()
    forbidden = (
        "저희 애",
        "제 아이",
        "제가 상담",
        "내담자",
        "환자",
        "진단해",
        "반드시 좋아",
        "무조건 잘",
    )
    return bool(
        15 <= len(normalized) <= 80
        and "\n" not in normalized
        and "?" not in normalized
        and "？" not in normalized
        and not any(token in normalized for token in forbidden)
        and not _similar_to_reflection(normalized, reflection)
    )


_NAMED_PATTERN_PREFERRED_IDS = {
    "mistake_not_identity",
    "past_pattern_not_destiny",
    "mixed_emotions_are_valid",
    "cumulative_load_matters",
    "compare_context_not_worth",
    "adapt_method_keep_value",
    "organize_information_roles",
    "method_cost_should_serve_goal",
    "hope_without_guarantee",
}


def _early_principle_min_score() -> float:
    try:
        return max(0.0, float(os.getenv("PRINCIPLE_EARLY_MIN_SCORE", "4.5")))
    except ValueError:
        return 4.5


def _skip_early_principle(user_utterance: str, current_slot: str) -> str | None:
    normalized = " ".join(str(user_utterance or "").split()).strip()
    if not normalized:
        return "no_answer"
    if len(normalized) > 160:
        return "long_answer"
    if current_slot == "duration" and len(normalized) <= 45:
        return "simple_fact"
    if re.fullmatch(
        r"(?:약\s*)?(?:\d+|한|두|세|네|몇)\s*(?:일|주|주일|달|개월|년)"
        r"(?:\s*(?:정도|쯤))?(?:\s*(?:됐|되었|이어졌).*)?",
        normalized,
    ):
        return "simple_fact"
    return None


def _preferred_principle_mode(
    candidate: PrincipleCandidate,
    state: SessionState,
) -> str:
    recent_count = len(state.get("recent_principle_ids") or [])
    if (
        candidate.principle_id in _NAMED_PATTERN_PREFERRED_IDS
        and recent_count % 2 == 1
        and "named_pattern" in candidate.available_modes
    ):
        return "named_pattern"
    return "social_context"


def _prepare_early_principle(
    *,
    state: SessionState,
    current_turn: int,
    current_slot: str,
    user_utterance: str,
    principle_candidates: tuple[PrincipleCandidate, ...],
) -> tuple[str, dict]:
    metadata = {
        "principle_selected": False,
        "principle_used": False,
        "principle_id": None,
        "principle_mode": "none",
        "principle_score": None,
        "principle_renderer": "none",
        "principle_render_ms": 0.0,
        "principle_skip_reason": "no_selection",
    }
    feature_mode = _principle_feature_mode()
    if feature_mode == "off":
        metadata["principle_skip_reason"] = "feature_off"
        return "", metadata

    skip_reason = _skip_early_principle(user_utterance, current_slot)
    if skip_reason:
        metadata["principle_skip_reason"] = skip_reason
        return "", metadata
    if not principle_candidates:
        return "", metadata

    selected = principle_candidates[0]
    selected_mode = _preferred_principle_mode(selected, state)
    metadata.update(
        {
            "principle_selected": True,
            "principle_id": selected.principle_id,
            "principle_mode": selected_mode,
            "principle_score": selected.score,
        }
    )
    if selected.score < _early_principle_min_score():
        metadata["principle_skip_reason"] = "low_score"
        return "", metadata
    if feature_mode == "shadow":
        metadata["principle_skip_reason"] = "shadow"
        return "", metadata
    if selected_mode not in selected.available_modes:
        metadata["principle_skip_reason"] = "mode_not_available"
        return "", metadata

    render_started = time.perf_counter()
    line = _principle_line(selected, selected_mode)
    metadata["principle_render_ms"] = round(
        (time.perf_counter() - render_started) * 1000,
        3,
    )
    if not _safe_principle_line(line, ""):
        metadata["principle_skip_reason"] = "unsafe_line"
        return "", metadata

    metadata["principle_skip_reason"] = "pending_delivery"
    return line, metadata


def _save_incidental_updates(
    analysis: dict,
    *,
    current_slot: str,
    slots: dict[str, list[str]],
    switches: dict[str, str],
) -> list[str]:
    saved: list[str] = []
    raw_updates = analysis.get("incidental_updates")
    if not isinstance(raw_updates, list):
        return saved

    seen: set[str] = set()
    for raw in raw_updates[:2]:
        if not isinstance(raw, dict):
            continue
        slot = str(raw.get("slot") or "")
        value = str(raw.get("value") or "").strip()
        if (
            slot not in SLOT_ORDER
            or slot == current_slot
            or slot in seen
            or not value
            or value == EXPLICIT_UNKNOWN_VALUE
        ):
            continue
        seen.add(slot)
        if value not in slots[slot]:
            slots[slot].append(value)
        if raw.get("sufficient") is True:
            slots[slot] = [
                item for item in slots[slot] if item != EXPLICIT_UNKNOWN_VALUE
            ]
            switches[slot] = "on"
        saved.append(slot)
    return saved


def _first_unresolved_slot(
    switches: dict[str, str],
    *,
    exclude: str | None = None,
) -> str | None:
    for slot in SLOT_ORDER:
        if slot != exclude and switches.get(slot, "off") == "off":
            return slot
    return None

_RAPPORT_STEPS = ["greeting", "mood", "how", "who"]


def _rapport_question(step: str, name: str) -> str:
    if step == "greeting":
        return prompts.RAPPORT_GREETING.format(name=name)
    if step == "mood":
        return prompts.RAPPORT_MOOD.format(name=name)
    if step == "how":
        return prompts.RAPPORT_HOW
    return prompts.RAPPORT_WHO


def _optimized_rapport_timeout_seconds() -> float:
    try:
        return max(
            0.05,
            float(os.getenv("OPTIMIZED_RAPPORT_TIMEOUT_SECONDS", "3.0")),
        )
    except ValueError:
        return 3.0


def rapport_node(state: SessionState) -> dict:
    """
    greeting -> mood -> how -> who -> loop
    """
    step = state.get("rapport_step", "greeting")
    user_input = state.get("user_input")

    if user_input is None:
        message = _rapport_question("greeting", state["name"])
        return {
            "bot_message": message,
            "rapport_step": "greeting",
            "conversation_log": _log(state, "bot", message),
        }

    next_index = _RAPPORT_STEPS.index(step) + 1
    next_step = _RAPPORT_STEPS[next_index] if next_index < len(_RAPPORT_STEPS) else None

    if step == "who":
        prefix_text = ""
    else:
        try:
            # Product decision: A and B use the same Gemini-minimal reflection
            # during scripted rapport. Only the later counseling loop differs.
            prefix_text = _reflect(
                state.get("bot_message") or "",
                user_input,
                api_route=os.getenv(
                    "OPTIMIZED_RESPONSE_API_ROUTE", "primary"
                ).strip(),
                thinking_level=os.getenv(
                    "OPTIMIZED_RESPONSE_THINKING_LEVEL"
                )
                or os.getenv("OPTIMIZED_RESPONSE_THINKING", "minimal").strip(),
                timeout_seconds=_optimized_rapport_timeout_seconds(),
            )
        except ModelProviderError:
            # The scripted rapport question is complete by itself, so a late
            # reflection can be omitted without blocking progression.
            prefix_text = ""
        publish_baseline_reflection(prefix_text, schedule_bridge=False)
    prefix = f"{prefix_text} " if prefix_text else ""
    log = _log(state, "user", user_input)

    if next_step is None:
        closing = f"{prefix}{prompts.RAPPORT_CLOSING}".strip()
        # Product decision: the waiting persona belongs only to deliberative
        # counseling-loop turns, not the scripted rapport.  Stream this closing
        # early, but intentionally keep the bridge disabled while the following
        # node generates the first loop question in the same invocation.
        publish_baseline_reflection(closing, schedule_bridge=False)
        mark_baseline_continuation_ready()
        return {
            "stage": "loop",
            "reflection_prefix": closing,
            "conversation_log": log,
        }

    message = f"{prefix}{_rapport_question(next_step, state['name'])}".strip()
    mark_baseline_continuation_ready()
    return {
        "bot_message": message,
        "rapport_step": next_step,
        "conversation_log": log + [{"role": "bot", "content": message}],
    }


def render_question_node(state: SessionState) -> dict:
    slots = {slot: list(state["slots"][slot]) for slot in SLOT_ORDER}
    retry_count = dict(state.get("retry_count") or {s: 0 for s in SLOT_ORDER})
    switches = dict(state.get("slot_switches") or {s: "off" for s in SLOT_ORDER})
    asked_slots = list(state.get("asked_slots") or [])
    pending = state.get("pending")

    if not pending:
        target_slot = _first_unresolved_slot(switches) or SLOT_ORDER[0]
        question = SLOT_FALLBACK_QUESTIONS[target_slot]
        reflection = state.get("reflection_prefix") or ""
        message = f"{reflection} {question}".strip()
        switches[target_slot] = "asking"
        if target_slot not in asked_slots:
            asked_slots.append(target_slot)
        mark_baseline_continuation_ready()
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
    current_turn = state["turn_count"] + 1
    last_aside_turn = state.get("last_aside_turn")
    aside_allowed = (
        last_aside_turn is None
        or current_turn - int(last_aside_turn) >= _aside_cooldown_turns()
    )
    local_analysis = _local_baseline_analysis(
        target_slot=current_slot,
        user_utterance=user_utterance,
    )

    # With physically separate API capacity, both calls can safely overlap.
    # On one shared endpoint, simultaneous requests showed severe queueing in
    # live probes. In that case publish the opening first, then analyze while it
    # is being read/spoken. Questions remain deterministic in either schedule.
    analyzer_separate = analyzer_api_is_separate()
    if analyzer_separate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            response_future = executor.submit(
                copy_context().run,
                _generate_baseline_opening,
                bot_question=state.get("bot_message") or "",
                user_utterance=user_utterance,
            )
            (
                principle_candidates,
                principle_lookup_ms,
                principle_retrieval_status,
            ) = _retrieve_candidates(
                state=state,
                current_slot=current_slot,
                user_utterance=user_utterance,
                aside_allowed=aside_allowed,
            )
            principle_aside, principle_metadata = _prepare_early_principle(
                state=state,
                current_turn=current_turn,
                current_slot=current_slot,
                user_utterance=user_utterance,
                principle_candidates=principle_candidates,
            )
            analysis_future = (
                executor.submit(
                    copy_context().run,
                    _analyze_baseline_turn,
                    target_slot=current_slot,
                    bot_question=state.get("bot_message") or "",
                    user_utterance=user_utterance,
                    api_route="analyzer",
                )
                if local_analysis is None
                else None
            )
            (
                opening,
                reflection,
                early_reflection,
                delivered_principle_aside,
            ) = _resolve_baseline_opening(
                response_future,
                target_slot=current_slot,
                principle_aside=principle_aside,
            )
            analysis = (
                analysis_future.result()
                if analysis_future is not None
                else local_analysis
            )
    else:
        with ThreadPoolExecutor(max_workers=1) as executor:
            response_future = executor.submit(
                copy_context().run,
                _generate_baseline_opening,
                bot_question=state.get("bot_message") or "",
                user_utterance=user_utterance,
            )
            (
                principle_candidates,
                principle_lookup_ms,
                principle_retrieval_status,
            ) = _retrieve_candidates(
                state=state,
                current_slot=current_slot,
                user_utterance=user_utterance,
                aside_allowed=aside_allowed,
            )
            principle_aside, principle_metadata = _prepare_early_principle(
                state=state,
                current_turn=current_turn,
                current_slot=current_slot,
                user_utterance=user_utterance,
                principle_candidates=principle_candidates,
            )
            (
                opening,
                reflection,
                early_reflection,
                delivered_principle_aside,
            ) = _resolve_baseline_opening(
                response_future,
                target_slot=current_slot,
                principle_aside=principle_aside,
            )
        analysis = local_analysis or _analyze_baseline_turn(
            target_slot=current_slot,
            bot_question=state.get("bot_message") or "",
            user_utterance=user_utterance,
            api_route="primary",
        )

    value = str(analysis.get("value") or "").strip()
    decision = str(analysis.get("decision") or "uncertain")
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
    if value == EXPLICIT_UNKNOWN_VALUE:
        value = ""
        decision = "explicit_unknown"
    if decision in {"explicit_unknown", "off_target", "no_answer"}:
        value = ""
    if decision == "sufficient" and not value:
        decision = "uncertain"

    if value and value not in slots[current_slot]:
        slots[current_slot].append(value)
    incidental_slots = _save_incidental_updates(
        analysis,
        current_slot=current_slot,
        slots=slots,
        switches=switches,
    )

    used_retry = retry_count.get(current_slot, 0) > 0
    needs_detail = (
        decision in {"detail", "off_target", "no_answer", "uncertain"}
        and not used_retry
    )

    if decision == "explicit_unknown":
        if EXPLICIT_UNKNOWN_VALUE not in slots[current_slot]:
            slots[current_slot].append(EXPLICIT_UNKNOWN_VALUE)
        switches[current_slot] = "unknown"
        target_slot = _first_unresolved_slot(switches, exclude=current_slot) or current_slot
        question = SLOT_FALLBACK_QUESTIONS[target_slot]
    elif needs_detail:
        retry_count[current_slot] = 1
        switches[current_slot] = "asking"
        target_slot = current_slot
        question = SLOT_DETAIL_QUESTIONS[target_slot]
    else:
        if decision == "sufficient" and value:
            switches[current_slot] = "on"
        else:
            if EXPLICIT_UNKNOWN_VALUE not in slots[current_slot]:
                slots[current_slot].append(EXPLICIT_UNKNOWN_VALUE)
            switches[current_slot] = "unknown"
        target_slot = _first_unresolved_slot(switches, exclude=current_slot) or current_slot
        question = SLOT_FALLBACK_QUESTIONS[target_slot]

    if target_slot != current_slot:
        switches[target_slot] = "asking"
        if target_slot not in asked_slots:
            asked_slots.append(target_slot)

    if (
        not principle_candidates
        and principle_metadata.get("principle_skip_reason") == "no_selection"
    ):
        principle_metadata["principle_skip_reason"] = principle_retrieval_status

    aside = delivered_principle_aside
    if principle_aside:
        if aside:
            principle_metadata.update(
                {
                    "principle_used": True,
                    "principle_renderer": "db_utterance",
                    "principle_skip_reason": None,
                }
            )
        else:
            principle_metadata["principle_used"] = False
            principle_metadata["principle_renderer"] = "none"
            principle_metadata["principle_skip_reason"] = (
                "bridge_won"
                if baseline_waiting_bridge_active()
                else "unsafe_or_repetitive_line"
            )

    message = " ".join(part for part in (reflection, aside, question) if part).strip()
    mark_baseline_continuation_ready()

    log = list(state["conversation_log"])
    if user_utterance:
        log.append({"role": "user", "content": user_utterance})
    log.append({"role": "bot", "content": message})

    debug_print(
        f"[SLOT DEBUG] target_slot={current_slot} decision={decision} "
        f"next_slot={target_slot} incidental={incidental_slots} "
        f"principle_mode={principle_metadata.get('principle_mode')} "
        f"aside_used={bool(aside)} "
        f"principle_id={principle_metadata.get('principle_id')} "
        f"principle_used={principle_metadata.get('principle_used')}"
    )
    recent_asides = list(state.get("recent_asides") or [])
    recent_principle_ids = list(state.get("recent_principle_ids") or [])
    if aside:
        recent_asides = (recent_asides + [aside])[-3:]
        last_aside_turn = current_turn
        if (
            principle_metadata.get("principle_used")
            and principle_metadata.get("principle_id")
        ):
            recent_principle_ids = (
                recent_principle_ids
                + [str(principle_metadata["principle_id"])]
            )[-3:]
    return {
        "slots": slots,
        "bot_message": message,
        "pending": {
            "target_slot": target_slot,
            "question_intent": SLOT_QUESTION_TEMPLATES[target_slot],
        },
        "asked_slots": asked_slots,
        "reflection_prefix": None,
        "turn_count": current_turn,
        "retry_count": retry_count,
        "slot_switches": switches,
        "last_aside_turn": last_aside_turn,
        "recent_asides": recent_asides,
        "recent_principle_ids": recent_principle_ids,
        "last_analysis": {
            "target_slot": current_slot,
            "decision": decision,
            "analysis_source": str(
                analysis.get("analysis_source") or "gemini"
            ),
            "incidental_slots": incidental_slots,
            "aside_needed": bool(principle_metadata.get("principle_selected")),
            "aside_mode": str(
                principle_metadata.get("principle_mode") or "none"
            ),
            "aside_used": bool(aside),
            "principle_lookup_ms": principle_lookup_ms,
            "principle_cache_hit": PRINCIPLE_SNAPSHOT.enabled,
            "principle_candidate_count": len(principle_candidates),
            "principle_retrieval_status": principle_retrieval_status,
            **principle_metadata,
            "fallback_used": bool(analysis.get("fallback_used")),
            "response_fallback_used": bool(
                opening.get("fallback_used") or early_reflection
            ),
        },
        "conversation_log": log,
    }

def gate_check_node(state: SessionState) -> dict:
    return {"gate": compute_gate(state)}


def _parse_value_selection(user_utterance: str) -> list[str] | None:
    seen: list[int] = []
    for token in re.findall(r"\d+", user_utterance):
        n = int(token)
        if 1 <= n <= len(VALUE_IDS) and n not in seen:
            seen.append(n)
    if len(seen) != 5:
        return None
    return [VALUE_IDS[n - 1] for n in seen]


def values_node(state: SessionState) -> dict:
    # gate_check can flip coverage_ok True and fall through to this node
    # within the same invoke() call that just processed the answer to the
    # *last loop slot* -- state["user_input"] at that point is still that
    # slot's answer, not a reply to the values question. Key off
    # values_prompted (only ever set True after this node has actually
    # paused and returned control to the user) instead of user_input's mere
    # presence, so that stale input is never mistaken for a values answer.
    if not state.get("values_prompted"):
        message = prompts.VALUES_INTRO.format(name=state["name"], value_list=value_list_text())
        return {
            "bot_message": message,
            "stage": "values",
            "values_prompted": True,
            "conversation_log": _log(state, "bot", message),
        }

    user_input = state.get("user_input") or ""
    log = _log(state, "user", user_input)
    selected = _parse_value_selection(user_input)

    if selected is None:
        message = prompts.VALUES_RETRY
        return {
            "bot_message": message,
            "stage": "values",
            "conversation_log": log + [{"role": "bot", "content": message}],
        }

    print("[선택된 가치]")
    for vid in selected:
        v = get_value(vid)
        print(f"  - {v['name_ko']} ({v['name_en']})")

    return {
        "selected_values": selected,
        "stage": "rapport",
        "conversation_log": log,
    }


# placeholder-ish non-answers the consolidate model sometimes emits when a
# slot had no real content -- these must not be accepted as genuine content
_NULL_LIKE_VALUES = {"없음", "(없음)", "null", "none", "-"}


def consolidate_slots_node(state: SessionState) -> dict:
    slots = state["slots"]
    result = _timed_llm_call(
        "CONSOLIDATE",
        prompts.CONSOLIDATE_SYSTEM,
        prompts.CONSOLIDATE_TASK.format(
            **{slot: " ".join(slots[slot]) or "(없음)" for slot in SLOT_ORDER}
        ),
    )
    consolidated = {}
    for slot in SLOT_ORDER:
        text = str(result.get(slot) or "").strip()
        if text.lower() in _NULL_LIKE_VALUES:
            text = ""
        consolidated[slot] = [text] if text else list(slots[slot])
    debug_print(f"[CONSOLIDATE DEBUG] before: {slots}")
    debug_print(f"[CONSOLIDATE DEBUG] after: {consolidated}")

    print("[최종 슬롯 정리]")
    for slot in SLOT_ORDER:
        content = " / ".join(consolidated[slot]) if consolidated[slot] else "X"
        print(f"  - {SLOT_KOREAN_LABELS[slot]}({slot}): {content}")

    return {"slots": consolidated}


def _format_selected_values(value_ids: list[str]) -> str:
    lines = []
    for vid in value_ids:
        v = get_value(vid)
        lines.append(f"- {v['name_ko']} ({v['name_en']}): {v['definition']}")
    return "\n".join(lines)


def _fallback_insight_report(state: SessionState) -> str:
    """Keep the session usable if Gemini repeatedly returns malformed report JSON."""
    slots = state["slots"]
    value_names = ", ".join(get_value(vid)["name_ko"] for vid in state["selected_values"])

    def joined(slot: str) -> str:
        return " ".join(slots[slot]) or "아직 확인되지 않음"

    return (
        "## 🧊 사티어 빙산 기반 내면 분석 리포트\n\n"
        "### 1. 수면 위의 모습: 현재의 표면적 대처 패턴\n"
        f"- 현재 상황은 {joined('situation')}이며, 행동과 대처는 "
        f"{joined('behavior')} / {joined('coping')}로 정리됩니다.\n\n"
        "### 2. 수면 아래 중간층: 지각과 기대\n"
        f"- 떠오르는 생각은 {joined('thought')}이고, 스스로 짐작한 원인은 "
        f"{joined('cause')}입니다.\n\n"
        "### 3. 빙산의 심층: 감정 뒤의 열망\n"
        f"- 느끼는 감정은 {joined('emotion')}이며, 일상과 관계에는 "
        f"{joined('impact')} / {joined('relationship')}의 영향이 있습니다.\n\n"
        "### 4. 빙산의 가장 깊은 곳: 가치와 자아\n"
        f"- 중요하게 고른 가치는 {value_names}입니다. 바라는 모습은 "
        f"{joined('goal')}이며, 스스로에게 건네고 싶은 말은 "
        f"{joined('self_message')}입니다. 지금까지 들려주신 내용을 바탕으로 "
        "작은 한 걸음부터 시작해 보셔도 좋겠습니다."
    )


def insight_report_node(state: SessionState) -> dict:
    if state.get("report"):
        user_input = state.get("user_input") or ""
        log = list(state["conversation_log"])
        if user_input:
            log.append({"role": "user", "content": user_input})
        log.append({"role": "bot", "content": prompts.SESSION_CLOSED_MESSAGE})
        return {"bot_message": prompts.SESSION_CLOSED_MESSAGE, "conversation_log": log}

    slots = state["slots"]

    try:
        result = _timed_llm_call(
            "INSIGHT_REPORT",
            prompts.INSIGHT_REPORT_SYSTEM,
            prompts.INSIGHT_REPORT_TASK.format(
                situation=" ".join(slots["situation"]) or "(없음)",
                thought=" ".join(slots["thought"]) or "(없음)",
                emotion=" ".join(slots["emotion"]) or "(없음)",
                cause=" ".join(slots["cause"]) or "(없음)",
                behavior=" ".join(slots["behavior"]) or "(없음)",
                impact=" ".join(slots["impact"]) or "(없음)",
                duration=" ".join(slots["duration"]) or "(없음)",
                relationship=" ".join(slots["relationship"]) or "(없음)",
                coping=" ".join(slots["coping"]) or "(없음)",
                goal=" ".join(slots["goal"]) or "(없음)",
                self_message=" ".join(slots["self_message"]) or "(없음)",
                values=_format_selected_values(state["selected_values"]),
            ),
            reasoning_effort="medium",
        )
        report = str(result.get("report", "")).strip()
        report_fallback = False
    except ModelProviderError:
        report = _fallback_insight_report(state)
        report_fallback = True

    return {
        "report": report,
        "report_fallback": report_fallback,
        "bot_message": report,
        "stage": "done",
        "conversation_log": _log(state, "bot", report),
    }
