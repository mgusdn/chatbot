import os
import time
from threading import Barrier

os.environ["AB_MOCK_MODE"] = "true"
os.environ["MOCK_GEMINI_DELAY_MS"] = "0"
os.environ["AB_RESULTS_PATH"] = "/private/tmp/pume-upstream-graph-test-results.jsonl"

from app.experiments import ExperimentStore
from counsel import baseline_nodes
from counsel.llm import ModelProviderError
from counsel import optimized_nodes
from counsel.gate import compute_gate
from counsel.prompts import CONTEXTUAL_ASIDE_LINES
from counsel.state import SLOT_ORDER, SLOT_QUESTION_TEMPLATES, new_session


RAPPORT_REPLIES = [
    "안녕하세요.",
    "오늘은 괜찮아요.",
    "편하게 왔어요.",
    "친구에게 소개받았어요.",
]


def _advance_to_loop(store: ExperimentStore, experiment_id: str, arm: str):
    result = store.run_turn(experiment_id, arm, "1, 2, 3, 4, 5")
    assert result["status"] == "ok"
    assert result["state"]["stage"] == "rapport"

    for message in RAPPORT_REPLIES:
        result = store.run_turn(experiment_id, arm, message)
        assert result["status"] == "ok"

    assert result["state"]["stage"] == "loop"
    assert result["state"]["pending_slot"] == "situation"
    return result


def test_value_selection_enters_rapport_without_repeating_the_value_prompt():
    store = ExperimentStore()
    experiment = store.create(name="테스터")

    result = store.run_turn(
        experiment["experiment_id"],
        "baseline",
        "1, 2, 3, 4, 5",
    )

    assert result["status"] == "ok"
    assert result["state"]["stage"] == "rapport"
    assert "정확히 5개" not in result["message"]
    assert "테스터님, 만나서 반갑습니다" in result["message"]


def test_latest_upstream_baseline_has_iceberg_slots_values_and_report():
    store = ExperimentStore()
    experiment = store.create(name="테스터")
    experiment_id = experiment["experiment_id"]
    _advance_to_loop(store, experiment_id, "baseline")

    CORE_SLOTS = ["situation", "emotion", "thought", "behavior", "coping", "goal"]
    result = None
    for index, slot in enumerate(SLOT_ORDER[:10]):
        result = store.run_turn(
            experiment_id,
            "baseline",
            f"{slot}에 관한 충분히 구체적인 {index + 1}번째 답변입니다.",
        )
        assert result["status"] == "ok"
        assert slot in result["state"]["filled_slots"]

    assert result is not None
    assert result["state"]["stage"] == "done"
    assert result["state"]["gate"]["coverage_ok"] is True
    assert set(CORE_SLOTS).issubset(set(result["state"]["filled_slots"]))
    assert {"consolidate_slots", "insight_report"} <= {
        call["task"] for call in result["calls"]
    }
    assert "빙산" in result["message"]


def test_baseline_general_slot_turn_uses_two_parallel_calls():
    store = ExperimentStore()
    experiment = store.create()
    experiment_id = experiment["experiment_id"]
    _advance_to_loop(store, experiment_id, "baseline")

    result = store.run_turn(
        experiment_id,
        "baseline",
        "요즘 과제가 계속 밀리고 있어서 답답해요.",
    )
    assert result["metrics"]["model_calls"] == 2
    assert {call["task"] for call in result["calls"]} == {
        "baseline_turn_analysis",
        "baseline_opening",
    }
    assert all(call["provider"] == "gemini" for call in result["calls"])
    assert result["metrics"]["fallback_used"] is False


def test_baseline_routes_analyzer_low_and_response_minimal_on_primary(monkeypatch):
    state = new_session("baseline", "baseline-profiles")
    state.update(
        {
            "stage": "loop",
            "user_input": "지원 준비를 자꾸 미루고 있어요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )
    observed = {}
    call_order = []

    def fake_call(label, _system, _user, **kwargs):
        call_order.append(label)
        observed[label] = kwargs
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "지원 준비를 자꾸 미룸",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [],
            }
        return {"empathy": "마음이 조급하셨겠어요."}

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    result = baseline_nodes.render_question_node(state)

    assert observed["TURN_ANALYSIS"]["reasoning_effort"] == "low"
    assert observed["TURN_ANALYSIS"]["timeout_seconds"] == 4.0
    assert observed["OPENING"]["thinking_level"] == "minimal"
    assert observed["OPENING"]["timeout_seconds"] == 4.0
    assert call_order == ["OPENING", "TURN_ANALYSIS"]
    assert result["pending"]["target_slot"] == "emotion"
    assert result["bot_message"].endswith("그 일로 요즘 어떤 감정이 드시나요?")


def test_baseline_uses_true_parallelism_only_with_separate_analyzer(monkeypatch):
    state = new_session("baseline", "baseline-separate-api")
    state.update(
        {
            "stage": "loop",
            "user_input": "지원 준비를 자꾸 미루고 있어요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )
    rendezvous = Barrier(2, timeout=1)
    routes = {}

    def fake_call(label, _system, _user, **kwargs):
        routes[label] = kwargs.get("api_route", "primary")
        rendezvous.wait()
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "지원 준비를 자꾸 미룸",
                "decision": "sufficient",
                "incidental_updates": [],
                "aside_mode": "none",
            }
        return {"empathy": "마음이 조급하셨겠어요."}

    monkeypatch.setattr(baseline_nodes, "analyzer_api_is_separate", lambda: True)
    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    result = baseline_nodes.render_question_node(state)

    assert routes == {"TURN_ANALYSIS": "analyzer", "OPENING": "primary"}
    assert result["pending"]["target_slot"] == "emotion"


def test_baseline_saves_at_most_two_incidental_slots(monkeypatch):
    state = new_session("baseline", "baseline-incidental")
    state.update(
        {
            "stage": "loop",
            "user_input": "자소서를 미루고 있어서 화가 나고 두 달째 반복돼요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )

    def fake_call(label, _system, _user, **_kwargs):
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "자소서 작성을 계속 미룸",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [
                    {
                        "slot": "emotion",
                        "value": "스스로에게 화가 남",
                        "sufficient": True,
                        "confidence": 0.97,
                    },
                    {
                        "slot": "coping",
                        "value": "알람을 맞춰봄",
                        "sufficient": False,
                        "confidence": 0.94,
                    },
                    {
                        "slot": "behavior",
                        "value": "자소서를 미루는 행동",
                        "sufficient": True,
                        "confidence": 0.99,
                    },
                ],
            }
        return {"empathy": "마음이 많이 답답하셨겠어요."}

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    result = baseline_nodes.render_question_node(state)

    assert result["slots"]["situation"] == ["자소서 작성을 계속 미룸"]
    assert result["slots"]["emotion"] == ["스스로에게 화가 남"]
    assert result["slots"]["coping"] == ["알람을 맞춰봄"]
    assert result["slots"]["behavior"] == []
    assert result["last_analysis"]["incidental_slots"] == ["emotion", "coping"]
    assert result["slot_switches"]["emotion"] == "on"
    assert result["slot_switches"]["coping"] == "off"
    assert result["pending"]["target_slot"] == "thought"


def test_baseline_explicit_unknown_moves_to_next_slot_without_reasking(monkeypatch):
    state = new_session("baseline", "baseline-unknown")
    state.update(
        {
            "stage": "loop",
            "user_input": "잘 모르겠어요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )

    call_order = []

    def fake_call(label, _system, _user, **_kwargs):
        call_order.append(label)
        if label == "TURN_ANALYSIS":
            raise AssertionError("명시적 모름은 로컬 규칙으로 처리해야 합니다.")
        return {"empathy": "바로 떠오르지 않을 수도 있어요."}

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    result = baseline_nodes.render_question_node(state)

    assert result["slots"]["situation"] == ["-"]
    assert result["retry_count"]["situation"] == 0
    assert result["pending"]["target_slot"] == "emotion"
    assert "어떤 감정" in result["bot_message"]
    assert result["last_analysis"]["analysis_source"] == "local_rule"
    assert call_order == ["OPENING"]


# The duration local rule (period + frequency skips the analyzer) is only
# reachable while the "duration" slot is enabled in SLOT_ORDER. Its test is
# removed alongside the slot; restore both together.


def test_baseline_local_rules_are_conservative_for_clear_single_slot_answers():
    clear_cases = {
        "emotion": "스스로한테 화도 나고 답답해요.",
        "thought": "이번에도 못 낼 것 같다는 생각이 들어요.",
        "coping": "알람은 도움이 됐지만 스터디는 오히려 부담이 됐어요.",
        "goal": "마감 전에 여유 있게 제출하는 사람이 되고 싶어요.",
    }
    for slot, utterance in clear_cases.items():
        analysis = baseline_nodes._local_baseline_analysis(
            target_slot=slot,
            user_utterance=utterance,
        )
        assert analysis is not None
        assert analysis["decision"] == "sufficient"
        assert analysis["analysis_source"] == "local_rule"

    ambiguous_cases = {
        "emotion": "그냥 그래요.",
        "thought": "아직은 애매해요.",
        "coping": "알람을 맞췄어요.",
        "goal": "잘 모르겠지만요.",
    }
    for slot, utterance in ambiguous_cases.items():
        assert baseline_nodes._local_baseline_analysis(
            target_slot=slot,
            user_utterance=utterance,
        ) is None


def test_baseline_analyzer_approves_aside_but_cooldown_prevents_repetition(monkeypatch):
    state = new_session("baseline", "baseline-aside-cooldown")
    state.update(
        {
            "stage": "loop",
            "user_input": "자소서를 마감 직전에 시작하게 돼요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )

    def fake_call(label, _system, _user, **_kwargs):
        if label == "TURN_ANALYSIS":
            target = state["pending"]["target_slot"]
            return {
                "target_slot": target,
                "value": "현재 질문에 관한 충분한 답변",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [],
                "aside_mode": "normalize",
            }
        return {"empathy": "마음이 많이 급해지셨겠어요."}

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    first = baseline_nodes.render_question_node(state)
    aside = next(
        str(principle["social_context"]["utterance"])
        for principle in baseline_nodes.PRINCIPLE_SNAPSHOT.principles
        if str(principle["social_context"]["utterance"]) in first["bot_message"]
    )
    assert first["last_analysis"]["aside_used"] is True
    assert first["last_analysis"]["principle_used"] is True
    assert aside in first["bot_message"]
    assert first["bot_message"].endswith("그 일로 요즘 어떤 감정이 드시나요?")

    state.update(first)
    state["user_input"] = "스스로에게 화가 나고 답답해요."
    second = baseline_nodes.render_question_node(state)
    assert second["last_analysis"]["aside_needed"] is False
    assert second["last_analysis"]["aside_used"] is False
    assert second["last_analysis"]["principle_used"] is False
    assert aside not in second["bot_message"]
    assert second["bot_message"].endswith(
        "그 문제를 떠올리면 스스로 어떤 생각이 드시나요?"
    )


def test_baseline_detail_uses_slot_locked_question_not_model_wording(monkeypatch):
    state = new_session("baseline", "baseline-fixed-detail")
    state.update(
        {
            "stage": "loop",
            "user_input": "그냥 힘들어요.",
            "bot_message": "요즘 어떤 고민이 있으신가요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
        }
    )

    def fake_call(label, _system, _user, **_kwargs):
        if label == "TURN_ANALYSIS":
            return {
                "target_slot": "situation",
                "value": "막연하게 힘듦",
                "decision": "detail",
                "missing_aspect": "너무 포괄적임",
                "confidence": 0.96,
                "incidental_updates": [],
                "aside_mode": "none",
            }
        return {"empathy": "말로 풀어내기도 막막하셨겠어요."}

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_call)
    result = baseline_nodes.render_question_node(state)

    assert result["pending"]["target_slot"] == "situation"
    assert result["bot_message"].endswith(
        "최근 가장 먼저 떠오르는 경험 하나를 편하게 들려주실 수 있나요?"
    )
    assert "엉뚱한 질문" not in result["bot_message"]


def test_optimized_general_slot_turn_uses_two_parallel_gemini_calls(monkeypatch):
    monkeypatch.setenv("MOCK_GEMINI_DELAY_MS", "100")
    store = ExperimentStore()
    experiment = store.create()
    experiment_id = experiment["experiment_id"]
    _advance_to_loop(store, experiment_id, "optimized")

    started = time.perf_counter()
    result = store.run_turn(
        experiment_id,
        "optimized",
        "요즘 과제가 계속 밀리고 있어서 답답해요.",
    )
    elapsed = time.perf_counter() - started
    assert result["metrics"]["model_calls"] == 2
    assert {call["task"] for call in result["calls"]} == {
        "target_slot_analysis",
        "response_candidates",
    }
    assert elapsed < 0.18
    assert result["metrics"]["model_ms"] >= 190


def test_optimized_rapport_reflection_uses_primary_minimal_profile(monkeypatch):
    state = new_session("optimized", "optimized-rapport-profile")
    state.update(
        {
            "user_input": "반가워요.",
            "bot_message": "안녕하세요.",
            "rapport_step": "greeting",
        }
    )
    observed = {}

    def fake_timed_call(label, system, user, **kwargs):
        observed.update(kwargs)
        return {"reflection": "저도 만나서 반가워요."}

    monkeypatch.setenv("BASELINE_RESPONSE_THINKING_LEVEL", "minimal")
    monkeypatch.setenv("RAPPORT_TIMEOUT_SECONDS", "0.75")
    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_timed_call)

    result = baseline_nodes.rapport_node(state)

    assert observed["api_route"] == "primary"
    assert observed["thinking_level"] == "minimal"
    assert observed["timeout_seconds"] == 0.75
    assert "저도 만나서 반가워요" in result["bot_message"]


def test_baseline_rapport_uses_same_gemini_profile_as_optimized(monkeypatch):
    state = new_session("baseline", "baseline-gemini-rapport")
    state.update(
        {
            "user_input": "오늘은 조금 긴장되지만 괜찮아요.",
            "bot_message": "오늘 기분은 어떠신가요?",
            "rapport_step": "mood",
        }
    )
    observed = {}

    def fake_timed_call(label, system, user, **kwargs):
        observed.update(kwargs)
        return {"reflection": "긴장되는 마음을 솔직히 나눠주셔서 고마워요."}

    monkeypatch.setenv("BASELINE_RESPONSE_THINKING_LEVEL", "minimal")
    monkeypatch.setenv("RAPPORT_TIMEOUT_SECONDS", "0.75")
    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fake_timed_call)
    result = baseline_nodes.rapport_node(state)

    assert observed["api_route"] == "primary"
    assert observed["thinking_level"] == "minimal"
    assert observed["timeout_seconds"] == 0.75
    assert "긴장되는 마음을 솔직히" in result["bot_message"]
    assert result["rapport_step"] == "how"


def _loop_state():
    state = new_session("optimized", "branch-test")
    state.update(
        {
            "stage": "loop",
            "user_input": "사용자 답변",
            "bot_message": "어떤 상황이 마음에 걸리나요?",
            "pending": {
                "target_slot": "situation",
                "question_intent": SLOT_QUESTION_TEMPLATES["situation"],
            },
            "asked_slots": ["situation"],
            "slot_switches": {
                **state["slot_switches"],
                "situation": "asking",
            },
        }
    )
    return state


def _loop_state_at(target_slot: str):
    state = new_session("optimized", f"branch-test:{target_slot}")
    asked_slots = []
    for slot in SLOT_ORDER:
        if slot == target_slot:
            break
        state["slots"][slot] = [f"{slot} 기존 답변"]
        state["slot_switches"][slot] = "on"
        asked_slots.append(slot)
    state.update(
        {
            "stage": "loop",
            "user_input": "사용자 답변",
            "bot_message": f"{target_slot}에 대해 알려주시겠어요?",
            "pending": {
                "target_slot": target_slot,
                "question_intent": SLOT_QUESTION_TEMPLATES[target_slot],
            },
            "asked_slots": asked_slots + [target_slot],
            "slot_switches": {
                **state["slot_switches"],
                target_slot: "asking",
            },
        }
    )
    return state


def test_optimized_sufficient_branch_turns_switch_on_and_moves_next(monkeypatch):
    state = _loop_state()

    def fake_call(provider, *, task, **kwargs):
        assert provider == "gemini"
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": "과제가 계속 밀림",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.95,
            }
        return {
            "reflection": "과제가 밀려 답답하셨군요.",
            "if_sufficient": "그때 어떤 감정이 들었나요?",
            "if_insufficient": "최근 장면을 하나 더 들려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)
    assert result["slot_switches"]["situation"] == "on"
    assert result["slot_switches"]["emotion"] == "asking"
    assert result["pending"]["target_slot"] == "emotion"
    assert "어떤 감정" in result["bot_message"]
    assert "최근 장면" not in result["bot_message"]


def test_optimized_routes_analyzer_low_and_response_primary_minimal(monkeypatch):
    state = _loop_state()
    observed = {}

    def fake_call(provider, *, task, **kwargs):
        assert provider == "gemini"
        observed[task] = kwargs
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": "지원 준비를 자꾸 미루고 있음",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [],
            }
        return {
            "reflection": "계속 미루게 되어 답답하셨겠어요.",
            "if_sufficient": "그때 어떤 감정이 드셨나요?",
            "if_insufficient": "최근 상황을 조금 더 들려주시겠어요?",
        }

    monkeypatch.setenv("OPTIMIZED_ANALYZER_REASONING_EFFORT", "low")
    monkeypatch.setenv("OPTIMIZED_RESPONSE_THINKING_LEVEL", "minimal")
    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)

    result = optimized_nodes.optimized_render_question_node(state)

    analyzer = observed["target_slot_analysis"]
    response = observed["response_candidates"]
    assert analyzer["api_route"] == "analyzer"
    assert analyzer["reasoning_effort"] == "low"
    assert analyzer.get("thinking_level") is None
    assert response["api_route"] == "primary"
    assert response["thinking_level"] == "minimal"
    assert response.get("reasoning_effort") is None
    assert result["pending"]["target_slot"] == "emotion"


def test_optimized_detail_branch_reasks_once_then_marks_unknown(monkeypatch):
    state = _loop_state()

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": None,
                "decision": "no_answer",
                "missing_aspect": "답변 없음",
                "confidence": 0.99,
            }
        return {
            "reflection": "천천히 떠올려도 괜찮아요.",
            "if_sufficient": "다음 이야기를 들려주시겠어요?",
            "if_insufficient": "최근 장면을 하나만 떠올려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    first = optimized_nodes.optimized_render_question_node(state)
    assert first["retry_count"]["situation"] == 1
    assert first["slot_switches"]["situation"] == "asking"
    assert first["pending"]["target_slot"] == "situation"
    assert "최근 장면" in first["bot_message"]

    state.update(first)
    state["user_input"] = "여전히 잘 모르겠어요."
    second = optimized_nodes.optimized_render_question_node(state)
    assert second["slots"]["situation"] == ["-"]
    assert second["slot_switches"]["situation"] == "unknown"
    assert second["slot_switches"]["emotion"] == "asking"
    assert second["pending"]["target_slot"] == "emotion"


def test_optimized_explicit_unknown_skips_immediately(monkeypatch):
    state = _loop_state()

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": None,
                "decision": "explicit_unknown",
                "missing_aspect": None,
                "confidence": 0.99,
                "incidental_updates": [],
            }
        return {
            "reflection": "바로 떠올리기 어려우실 수 있어요.",
            "if_sufficient": "그때 어떤 감정이 드셨나요?",
            "if_insufficient": "최근 장면을 떠올려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slots"]["situation"] == ["-"]
    assert result["slot_switches"]["situation"] == "unknown"
    assert result["retry_count"]["situation"] == 0
    assert result["pending"]["target_slot"] == "emotion"
    assert "어떤 감정" in result["bot_message"]


def test_optimized_off_target_saves_sufficient_incidental_coping(monkeypatch):
    # Target a slot that precedes coping, so coping is still empty and the
    # incidental save is unambiguous.
    state = _loop_state_at("behavior")
    state["user_input"] = "알람과 스터디를 해봤지만 스터디는 도움이 안 됐어요."

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "behavior",
                "value": None,
                "decision": "off_target",
                "missing_aspect": None,
                "confidence": 0.97,
                "incidental_updates": [
                    {
                        "slot": "coping",
                        "value": "알람과 스터디를 시도했고 스터디는 도움이 되지 않았음",
                        "sufficient": True,
                        "confidence": 0.96,
                    }
                ],
            }
        return {
            "reflection": "여러 방법을 시도해보셨군요.",
            "if_sufficient": "다음 이야기를 들려주시겠어요?",
            "if_insufficient": "그럴 때 자주 하게 되는 행동이 있나요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slots"]["coping"] == [
        "알람과 스터디를 시도했고 스터디는 도움이 되지 않았음"
    ]
    assert result["slot_switches"]["coping"] == "on"
    assert result["slot_switches"]["behavior"] == "asking"
    assert result["retry_count"]["behavior"] == 1
    assert result["pending"]["target_slot"] == "behavior"
    assert "coping" not in result["asked_slots"]


def test_optimized_partial_incidental_is_saved_but_stays_open(monkeypatch):
    state = _loop_state_at("coping")
    state["user_input"] = "미리 준비하는 사람이 되고 싶어요."

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "coping",
                "value": None,
                "decision": "off_target",
                "missing_aspect": None,
                "confidence": 0.95,
                "incidental_updates": [
                    {
                        "slot": "goal",
                        "value": "미리 준비하는 사람이 되고 싶음",
                        "sufficient": False,
                        "confidence": 0.93,
                    }
                ],
            }
        return {
            "reflection": "바라는 모습이 있으시군요.",
            "if_sufficient": "다음 이야기를 들려주시겠어요?",
            "if_insufficient": "전에 시도해 본 방법이 있었나요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slots"]["goal"] == ["미리 준비하는 사람이 되고 싶음"]
    assert result["slot_switches"]["goal"] == "off"
    assert result["pending"]["target_slot"] == "coping"


def test_optimized_partial_incidental_does_not_reopen_unknown(monkeypatch):
    state = _loop_state_at("coping")
    state["slots"]["goal"] = ["-"]
    state["slot_switches"]["goal"] = "unknown"

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "coping",
                "value": None,
                "decision": "off_target",
                "missing_aspect": None,
                "confidence": 0.95,
                "incidental_updates": [
                    {
                        "slot": "goal",
                        "value": "조금 더 나아지고 싶음",
                        "sufficient": False,
                        "confidence": 0.93,
                    }
                ],
            }
        return {
            "reflection": "바라는 모습이 있으시군요.",
            "if_sufficient": "다음 이야기를 들려주시겠어요?",
            "if_insufficient": "전에 시도해 본 방법이 있었나요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slots"]["goal"] == ["-", "조금 더 나아지고 싶음"]
    assert result["slot_switches"]["goal"] == "unknown"


def test_optimized_rejects_unknown_sentinel_as_incidental_value(monkeypatch):
    state = _loop_state()

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": "지원 준비가 계속 늦어짐",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [
                    {
                        "slot": "goal",
                        "value": "-",
                        "sufficient": True,
                        "confidence": 0.99,
                    }
                ],
            }
        return {
            "reflection": "준비가 늦어져 힘드셨겠어요.",
            "if_sufficient": "그때 어떤 감정이 드셨나요?",
            "if_insufficient": "상황을 더 들려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slots"]["goal"] == []
    assert result["slot_switches"]["goal"] == "off"


def test_optimized_skips_completed_incidental_and_discards_stale_question(monkeypatch):
    state = _loop_state()

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": "지원 마감 직전에 자소서를 시작함",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [
                    {
                        "slot": "emotion",
                        "value": "조급함",
                        "sufficient": True,
                        "confidence": 0.95,
                    }
                ],
            }
        return {
            "reflection": "마감에 쫓겨 힘드셨겠어요.",
            "if_sufficient": "버려져야 할 감정 질문",
            "if_insufficient": "상황을 더 들려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert result["slot_switches"]["emotion"] == "on"
    assert result["pending"]["target_slot"] == "thought"
    assert "버려져야 할" not in result["bot_message"]
    assert "어떤 생각" in result["bot_message"]


def test_optimized_gate_accepts_sufficient_unasked_incidental_slots():
    optimized = new_session("optimized", "optimized-gate")
    baseline = new_session("baseline", "baseline-gate")
    for state in (optimized, baseline):
        state["slots"] = {slot: [f"{slot} 답변"] for slot in SLOT_ORDER}
        state["slot_switches"] = {slot: "on" for slot in SLOT_ORDER}
        state["asked_slots"] = ["situation"]

    assert compute_gate(optimized)["coverage_ok"] is True
    assert compute_gate(baseline)["coverage_ok"] is True


def test_optimized_analyzer_failure_uses_bounded_fallback(monkeypatch):
    state = _loop_state()
    observed = {}

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            observed["timeout_seconds"] = kwargs.get("timeout_seconds")
            observed["api_route"] = kwargs.get("api_route")
            observed["reasoning_effort"] = kwargs.get("reasoning_effort")
            raise ModelProviderError("analyzer timeout")
        observed["response_api_route"] = kwargs.get("api_route")
        observed["response_thinking_level"] = kwargs.get("thinking_level")
        return {
            "reflection": "천천히 말씀해주셔도 괜찮아요.",
            "if_sufficient": "다음 이야기를 들려주시겠어요?",
            "if_insufficient": "최근 장면을 하나만 더 들려주시겠어요?",
        }

    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)
    result = optimized_nodes.optimized_render_question_node(state)

    assert observed["timeout_seconds"] == 3.5
    assert observed["api_route"] == "analyzer"
    assert observed["reasoning_effort"] == "low"
    assert observed["response_api_route"] == "primary"
    assert observed["response_thinking_level"] == "minimal"
    assert result["last_analysis"]["fallback_used"] is True
    assert result["last_analysis"]["decision"] == "uncertain"
    assert result["slot_switches"]["situation"] == "asking"
    assert result["pending"]["target_slot"] == "situation"
    assert "최근 장면" in result["bot_message"]


def test_optimized_response_timeout_uses_deterministic_wording_without_losing_analysis(
    monkeypatch,
):
    state = _loop_state()
    observed = {}

    def fake_call(provider, *, task, **kwargs):
        if task == "target_slot_analysis":
            return {
                "target_slot": "situation",
                "value": "지원 준비를 계속 미루고 있음",
                "decision": "sufficient",
                "missing_aspect": None,
                "confidence": 0.98,
                "incidental_updates": [],
            }
        observed.update(kwargs)
        raise ModelProviderError("response timeout")

    monkeypatch.setenv("OPTIMIZED_RESPONSE_TIMEOUT_SECONDS", "0.25")
    monkeypatch.setattr(optimized_nodes, "call_model_json", fake_call)

    result = optimized_nodes.optimized_render_question_node(state)

    assert observed["api_route"] == "primary"
    assert observed["thinking_level"] == "minimal"
    assert observed["timeout_seconds"] == 0.25
    assert result["last_analysis"]["decision"] == "sufficient"
    assert result["slot_switches"]["situation"] == "on"
    assert result["slot_switches"]["emotion"] == "asking"
    assert result["pending"]["target_slot"] == "emotion"
    assert "말씀해 주신 내용을 잘 들었어요" in result["bot_message"]
    assert "어떤 감정" in result["bot_message"]


def test_report_failure_returns_deterministic_four_section_fallback(monkeypatch):
    state = new_session("baseline", "fallback-test")
    state["stage"] = "values"
    state["slots"] = {
        slot: [f"{slot} 내용"] for slot in SLOT_ORDER
    }
    state["selected_values"] = ["justice", "pleasure", "love", "loyalty", "physical_appearance"]

    def fail_report(*args, **kwargs):
        raise ModelProviderError("malformed report JSON")

    monkeypatch.setattr(baseline_nodes, "_timed_llm_call", fail_report)
    result = baseline_nodes.insight_report_node(state)
    assert result["stage"] == "done"
    assert result["report_fallback"] is True
    assert all(f"### {index}." in result["report"] for index in range(1, 5))
